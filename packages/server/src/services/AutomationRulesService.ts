import prisma from '../lib/prisma';
import cron from 'node-cron';
import logger from '../utils/logger';
import { ServerService } from './ServerService';
import { BackupService } from './BackupService';
import { ActivityLogService } from './ActivityLogService';
import { ACTIVITY_ACTIONS, RESOURCE_TYPES } from '../constants/ActivityLogActions';


export type TriggerType = 'scheduled' | 'event' | 'condition';
export type EventType = 'server_start' | 'server_stop' | 'player_join' | 'player_leave' | 'high_cpu' | 'high_memory';
export type ConditionType = 'cpu_usage' | 'memory_usage' | 'disk_usage' | 'player_count';
export type ConditionOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
export type ActionType = 'start_server' | 'stop_server' | 'restart_server' | 'send_command' | 'create_backup' | 'send_alert';

export interface TriggerConfig {
  cron?: string;
  event?: EventType;
  thresholds?: {
    cpuUsage?: number;
    memoryUsage?: number;
    diskUsage?: number;
    playerCount?: number;
  };
}

export interface Condition {
  type: ConditionType;
  operator: ConditionOperator;
  value: number;
}

export interface Action {
  type: ActionType;
  config: any;
}

export interface AutomationRuleInfo {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  conditions?: Condition[];
  actions: Action[];
  backupLimit: number;
  lastTriggered?: Date;
  lastStatus?: string;
  lastError?: string;
  executionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRuleData {
  serverId: string;
  name: string;
  description?: string;
  enabled?: boolean;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  conditions?: Condition[];
  actions: Action[];
  backupLimit?: number;
}

export class AutomationRulesService {
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();
  private serverService: ServerService;
  private backupService: BackupService;
  private activityLogService?: ActivityLogService;

  constructor(serverService: ServerService, backupService: BackupService, activityLogService?: ActivityLogService) {
    this.serverService = serverService;
    this.backupService = backupService;
    this.activityLogService = activityLogService;
  }

  /**
   * Initialize automation rules (start scheduled tasks)
   */
  async initialize(): Promise<void> {
    const rules = await prisma.automationRule.findMany({
      where: {
        enabled: true,
        triggerType: 'scheduled',
      },
    });

    for (const rule of rules) {
      try {
        await this.scheduleRule(rule.id);
      } catch (error: any) {
        logger.error(`Failed to schedule rule ${rule.id}:`, error);
      }
    }

    logger.info(`Initialized ${rules.length} automation rules`);
  }

  /**
   * Create automation rule
   */
  async createRule(data: CreateRuleData): Promise<AutomationRuleInfo> {
    const rule = await prisma.automationRule.create({
      data: {
        serverId: data.serverId,
        name: data.name,
        description: data.description,
        enabled: data.enabled ?? true,
        triggerType: data.triggerType,
        triggerConfig: JSON.stringify(data.triggerConfig),
        conditions: data.conditions ? JSON.stringify(data.conditions) : null,
        actions: JSON.stringify(data.actions),
        backupLimit: data.backupLimit ?? 10,
      },
    });

    const ruleInfo = this.mapToRuleInfo(rule);

    // Schedule if it's a scheduled trigger and enabled
    if (rule.enabled && rule.triggerType === 'scheduled') {
      await this.scheduleRule(rule.id);
    }

    logger.info(`Automation rule created: ${data.name}`);

    return ruleInfo;
  }

  /**
   * Get automation rules
   */
  async getRules(serverId?: string): Promise<AutomationRuleInfo[]> {
    const where: any = {};
    if (serverId) {
      where.serverId = serverId;
    }

    const rules = await prisma.automationRule.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return rules.map(this.mapToRuleInfo);
  }

  /**
   * Get rule by ID
   */
  async getRule(ruleId: string): Promise<AutomationRuleInfo | null> {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
    });

    if (!rule) return null;

    return this.mapToRuleInfo(rule);
  }

  /**
   * Update automation rule
   */
  async updateRule(ruleId: string, data: Partial<CreateRuleData>): Promise<AutomationRuleInfo> {
    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.triggerType !== undefined) updateData.triggerType = data.triggerType;
    if (data.triggerConfig !== undefined) updateData.triggerConfig = JSON.stringify(data.triggerConfig);
    if (data.conditions !== undefined) updateData.conditions = data.conditions ? JSON.stringify(data.conditions) : null;
    if (data.actions !== undefined) updateData.actions = JSON.stringify(data.actions);
    if (data.backupLimit !== undefined) updateData.backupLimit = data.backupLimit;

    const rule = await prisma.automationRule.update({
      where: { id: ruleId },
      data: updateData,
    });

    // Reschedule if it's a scheduled trigger
    if (rule.triggerType === 'scheduled') {
      await this.unscheduleRule(ruleId);
      if (rule.enabled) {
        await this.scheduleRule(ruleId);
      }
    }

    return this.mapToRuleInfo(rule);
  }

  /**
   * Delete automation rule
   */
  async deleteRule(ruleId: string): Promise<void> {
    await this.unscheduleRule(ruleId);

    await prisma.automationRule.delete({
      where: { id: ruleId },
    });

    logger.info(`Automation rule deleted: ${ruleId}`);
  }

  /**
   * Toggle rule enabled status
   */
  async toggleRule(ruleId: string, enabled: boolean): Promise<void> {
    const rule = await prisma.automationRule.update({
      where: { id: ruleId },
      data: { enabled },
    });

    if (rule.triggerType === 'scheduled') {
      if (enabled) {
        await this.scheduleRule(ruleId);
      } else {
        await this.unscheduleRule(ruleId);
      }
    }
  }

  /**
   * Execute rule manually
   */
  async executeRule(ruleId: string): Promise<void> {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
    });

    if (!rule) {
      throw new Error('Rule not found');
    }

    const ruleInfo = this.mapToRuleInfo(rule);

    await this.executeActions(ruleInfo);
  }

  /**
   * Schedule a rule
   */
  private async scheduleRule(ruleId: string): Promise<void> {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
    });

    if (!rule || rule.triggerType !== 'scheduled') {
      return;
    }

    const triggerConfig: TriggerConfig = JSON.parse(rule.triggerConfig);

    if (!triggerConfig.cron) {
      logger.warn(`Rule ${ruleId} has no cron expression`);
      return;
    }

    // Unschedule if already scheduled
    await this.unscheduleRule(ruleId);

    // Schedule the task
    const task = cron.schedule(triggerConfig.cron, async () => {
      try {
        await this.executeRule(ruleId);
      } catch (error: any) {
        logger.error(`Error executing scheduled rule ${ruleId}:`, error);
      }
    });

    this.scheduledTasks.set(ruleId, task);
    logger.info(`Scheduled automation rule ${rule.name} with cron: ${triggerConfig.cron}`);
  }

  /**
   * Unschedule a rule
   */
  private async unscheduleRule(ruleId: string): Promise<void> {
    const task = this.scheduledTasks.get(ruleId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(ruleId);
      logger.debug(`Unscheduled automation rule ${ruleId}`);
    }
  }

  /**
   * Execute rule actions
   */
  private async executeActions(rule: AutomationRuleInfo): Promise<void> {
    logger.info(`Executing automation rule: ${rule.name}`);

    try {
      // Check conditions if any
      if (rule.conditions && rule.conditions.length > 0) {
        const conditionsMet = await this.checkConditions(rule.serverId, rule.conditions);
        if (!conditionsMet) {
          logger.info(`Conditions not met for rule ${rule.name}, skipping`);
          return;
        }
      }

      // Execute actions
      for (const action of rule.actions) {
        await this.executeAction(rule, action);
      }

      // Update execution info
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: {
          lastTriggered: new Date(),
          lastStatus: 'success',
          lastError: null,
          executionCount: {
            increment: 1,
          },
        },
      });

      // Log to activity log
      this.activityLogService?.logAsync({
        userId: 'system',
        username: 'Automation',
        userRole: 'system',
        action: ACTIVITY_ACTIONS.AUTOMATION_EXECUTE,
        resourceType: RESOURCE_TYPES.AUTOMATION,
        resourceId: rule.id,
        resourceName: rule.name,
        status: 'success',
        details: {
          serverId: rule.serverId,
          triggerType: rule.triggerType,
          actions: rule.actions.map(a => a.type),
        },
      });

      logger.info(`Successfully executed automation rule: ${rule.name}`);
    } catch (error: any) {
      logger.error(`Error executing automation rule ${rule.name}:`, error);

      await prisma.automationRule.update({
        where: { id: rule.id },
        data: {
          lastTriggered: new Date(),
          lastStatus: 'failed',
          lastError: error.message,
          executionCount: {
            increment: 1,
          },
        },
      });

      // Log failure to activity log
      this.activityLogService?.logAsync({
        userId: 'system',
        username: 'Automation',
        userRole: 'system',
        action: ACTIVITY_ACTIONS.AUTOMATION_EXECUTE,
        resourceType: RESOURCE_TYPES.AUTOMATION,
        resourceId: rule.id,
        resourceName: rule.name,
        status: 'failed',
        errorMessage: error.message,
        details: {
          serverId: rule.serverId,
          triggerType: rule.triggerType,
          actions: rule.actions.map(a => a.type),
        },
      });
    }
  }

  /**
   * Check if conditions are met
   */
  private async checkConditions(serverId: string, conditions: Condition[]): Promise<boolean> {
    const latestMetric = await prisma.serverMetric.findFirst({
      where: { serverId },
      orderBy: { timestamp: 'desc' },
    });

    if (!latestMetric) {
      return false;
    }

    for (const condition of conditions) {
      let value = 0;

      switch (condition.type) {
        case 'cpu_usage':
          value = latestMetric.cpuUsage;
          break;
        case 'memory_usage':
          value = latestMetric.memoryUsage;
          break;
        case 'disk_usage':
          value = latestMetric.diskUsage;
          break;
        case 'player_count':
          value = latestMetric.playerCount;
          break;
      }

      const met = this.checkCondition(value, condition.operator, condition.value);
      if (!met) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check a single condition
   */
  private checkCondition(value: number, operator: ConditionOperator, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(rule: AutomationRuleInfo, action: Action): Promise<void> {
    const serverId = rule.serverId;

    switch (action.type) {
      case 'start_server':
        await this.serverService.startServer(serverId);
        break;

      case 'stop_server':
        await this.serverService.stopServer(serverId);
        break;

      case 'restart_server':
        await this.serverService.restartServer(serverId);
        break;

      case 'send_command':
        // Note: sendCommand would need to be implemented in ServerService
        logger.info(`Would send command to server ${serverId}: ${action.config.command}`);
        break;

      case 'create_backup':
        const description = action.config?.description || `Automated backup from rule: ${rule.name}`;
        logger.info(`Creating automated backup for server ${serverId} (rule: ${rule.name})`);
        await this.backupService.createBackup(serverId, description, rule.id);
        break;

      case 'send_alert':
        // This would integrate with AlertsService
        logger.info(`Sending alert: ${action.config.message}`);
        break;

      default:
        logger.warn(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Trigger event-based rules
   */
  async triggerEvent(serverId: string, event: EventType): Promise<void> {
    const rules = await prisma.automationRule.findMany({
      where: {
        serverId,
        enabled: true,
        triggerType: 'event',
      },
    });

    for (const rule of rules) {
      const triggerConfig: TriggerConfig = JSON.parse(rule.triggerConfig);

      if (triggerConfig.event === event) {
        const ruleInfo = this.mapToRuleInfo(rule);
        await this.executeActions(ruleInfo);
      }
    }
  }

  /**
   * Map database rule to RuleInfo
   */
  private mapToRuleInfo(rule: any): AutomationRuleInfo {
    return {
      id: rule.id,
      serverId: rule.serverId,
      name: rule.name,
      description: rule.description || undefined,
      enabled: rule.enabled,
      triggerType: rule.triggerType,
      triggerConfig: JSON.parse(rule.triggerConfig),
      conditions: rule.conditions ? JSON.parse(rule.conditions) : undefined,
      actions: JSON.parse(rule.actions),
      backupLimit: rule.backupLimit,
      lastTriggered: rule.lastTriggered || undefined,
      lastStatus: rule.lastStatus || undefined,
      lastError: rule.lastError || undefined,
      executionCount: rule.executionCount,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  /**
   * Cleanup - stop all scheduled tasks
   */
  cleanup(): void {
    for (const [, task] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    logger.info('Cleaned up all automation rule schedules');
  }
}
