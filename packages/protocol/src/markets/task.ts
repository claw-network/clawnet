import { EventEnvelope } from '@clawtoken/core/protocol';
import {
  createMarketListingPublishEnvelope,
  MarketListingPublishEventParams,
} from './events.js';
import { MarketListing } from './types.js';

export const TASK_TYPES = ['one_time', 'project', 'ongoing', 'contest', 'bounty'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

export const TASK_COMPLEXITIES = ['simple', 'moderate', 'complex', 'expert'] as const;
export type TaskComplexity = (typeof TASK_COMPLEXITIES)[number];

export function isTaskComplexity(value: string): value is TaskComplexity {
  return (TASK_COMPLEXITIES as readonly string[]).includes(value);
}

export const DELIVERABLE_TYPES = ['file', 'code', 'data', 'report', 'service', 'result', 'other'] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export function isDeliverableType(value: string): value is DeliverableType {
  return (DELIVERABLE_TYPES as readonly string[]).includes(value);
}

export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export function isSkillLevel(value: string): value is SkillLevel {
  return (SKILL_LEVELS as readonly string[]).includes(value);
}

export type BiddingType = 'open' | 'sealed' | 'reverse';
export type AutoSelectCriteria = 'lowest' | 'highest_rated' | 'best_match';

export interface TaskDeliverable {
  id?: string;
  name: string;
  description?: string;
  type: DeliverableType;
  required: boolean;
  acceptanceCriteria?: string[];
  format?: string;
}

export interface TaskSkill {
  name: string;
  level: SkillLevel;
  required: boolean;
}

export interface TaskTimeline {
  startBy?: number;
  deadline?: number;
  flexible: boolean;
}

export interface TaskWorkerRequirements {
  minReputation?: number;
  requiredSkills?: string[];
  requiredVerifications?: string[];
  preferredWorkers?: string[];
  maxWorkers?: number;
}

export interface TaskBiddingSettings {
  type: BiddingType;
  open?: {
    visibleBids?: boolean;
    allowCounterOffers?: boolean;
  };
  sealed?: {
    revealTime?: number;
  };
  reverse?: {
    startingPrice?: string;
    minDecrement?: string;
  };
  bidDeadline?: number;
  autoSelect?: {
    enabled: boolean;
    criteria: AutoSelectCriteria;
  };
}

export interface TaskMilestone {
  id: string;
  name: string;
  description?: string;
  deliverables?: string[];
  percentage: number;
  deadline?: number;
  status?: string;
}

export interface TaskMarketData {
  taskType: TaskType;
  task: {
    requirements: string;
    deliverables: TaskDeliverable[];
    skills: TaskSkill[];
    complexity: TaskComplexity;
    estimatedDuration: number;
  };
  timeline: TaskTimeline;
  workerRequirements?: TaskWorkerRequirements;
  bidding?: TaskBiddingSettings;
  milestones?: TaskMilestone[];
}

export interface TaskListing extends MarketListing {
  marketType: 'task';
  marketData: TaskMarketData;
}

export type TaskListingPublishEventParams =
  Omit<MarketListingPublishEventParams, 'marketType' | 'marketData'> & {
    marketData: TaskMarketData;
  };

function requireNonEmpty(value: string, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`${field} must contain strings`);
    }
    const trimmed = entry.trim();
    if (trimmed.length) {
      result.push(trimmed);
    }
  }
  return result;
}

function parseDeliverables(value: unknown): TaskDeliverable[] {
  if (!Array.isArray(value)) {
    throw new Error('task.deliverables must be an array');
  }
  return value.map((entry, index) => {
    const record = assertRecord(entry, `task.deliverables[${index}]`);
    const name = requireNonEmpty(String(record.name ?? ''), `task.deliverables[${index}].name`);
    const typeValue = String(record.type ?? '');
    if (!isDeliverableType(typeValue)) {
      throw new Error(`task.deliverables[${index}].type is invalid`);
    }
    const requiredValue = record.required;
    if (typeof requiredValue !== 'boolean') {
      throw new Error(`task.deliverables[${index}].required must be a boolean`);
    }
    const acceptanceCriteria = record.acceptanceCriteria !== undefined
      ? parseStringArray(record.acceptanceCriteria, `task.deliverables[${index}].acceptanceCriteria`)
      : undefined;
    return {
      id: typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : undefined,
      name,
      description: typeof record.description === 'string' ? record.description : undefined,
      type: typeValue,
      required: requiredValue,
      acceptanceCriteria,
      format: typeof record.format === 'string' ? record.format : undefined,
    };
  });
}

function parseSkills(value: unknown): TaskSkill[] {
  if (!Array.isArray(value)) {
    throw new Error('task.skills must be an array');
  }
  return value.map((entry, index) => {
    const record = assertRecord(entry, `task.skills[${index}]`);
    const name = requireNonEmpty(String(record.name ?? ''), `task.skills[${index}].name`);
    const levelValue = String(record.level ?? '');
    if (!isSkillLevel(levelValue)) {
      throw new Error(`task.skills[${index}].level is invalid`);
    }
    const requiredValue = record.required;
    if (typeof requiredValue !== 'boolean') {
      throw new Error(`task.skills[${index}].required must be a boolean`);
    }
    return {
      name,
      level: levelValue,
      required: requiredValue,
    };
  });
}

function parseTimeline(value: unknown): TaskTimeline {
  const record = assertRecord(value, 'timeline');
  const flexibleValue = record.flexible;
  if (typeof flexibleValue !== 'boolean') {
    throw new Error('timeline.flexible must be a boolean');
  }
  const startBy = record.startBy;
  if (startBy !== undefined && typeof startBy !== 'number') {
    throw new Error('timeline.startBy must be a number');
  }
  const deadline = record.deadline;
  if (deadline !== undefined && typeof deadline !== 'number') {
    throw new Error('timeline.deadline must be a number');
  }
  return {
    flexible: flexibleValue,
    startBy: typeof startBy === 'number' ? startBy : undefined,
    deadline: typeof deadline === 'number' ? deadline : undefined,
  };
}

function parseWorkerRequirements(value: unknown): TaskWorkerRequirements {
  const record = assertRecord(value, 'workerRequirements');
  const minReputation = record.minReputation;
  if (minReputation !== undefined && typeof minReputation !== 'number') {
    throw new Error('workerRequirements.minReputation must be a number');
  }
  const requiredSkills = record.requiredSkills !== undefined
    ? parseStringArray(record.requiredSkills, 'workerRequirements.requiredSkills')
    : undefined;
  const requiredVerifications = record.requiredVerifications !== undefined
    ? parseStringArray(record.requiredVerifications, 'workerRequirements.requiredVerifications')
    : undefined;
  const preferredWorkers = record.preferredWorkers !== undefined
    ? parseStringArray(record.preferredWorkers, 'workerRequirements.preferredWorkers')
    : undefined;
  const maxWorkers = record.maxWorkers;
  if (maxWorkers !== undefined && typeof maxWorkers !== 'number') {
    throw new Error('workerRequirements.maxWorkers must be a number');
  }
  return {
    minReputation: typeof minReputation === 'number' ? minReputation : undefined,
    requiredSkills,
    requiredVerifications,
    preferredWorkers,
    maxWorkers: typeof maxWorkers === 'number' ? maxWorkers : undefined,
  };
}

function parseBiddingSettings(value: unknown): TaskBiddingSettings {
  const record = assertRecord(value, 'bidding');
  const typeValue = String(record.type ?? '');
  if (typeValue !== 'open' && typeValue !== 'sealed' && typeValue !== 'reverse') {
    throw new Error('bidding.type is invalid');
  }
  const settings: TaskBiddingSettings = { type: typeValue as BiddingType };

  if (record.open !== undefined) {
    const open = assertRecord(record.open, 'bidding.open');
    if (open.visibleBids !== undefined && typeof open.visibleBids !== 'boolean') {
      throw new Error('bidding.open.visibleBids must be a boolean');
    }
    if (open.allowCounterOffers !== undefined && typeof open.allowCounterOffers !== 'boolean') {
      throw new Error('bidding.open.allowCounterOffers must be a boolean');
    }
    settings.open = {
      visibleBids: typeof open.visibleBids === 'boolean' ? open.visibleBids : undefined,
      allowCounterOffers: typeof open.allowCounterOffers === 'boolean'
        ? open.allowCounterOffers
        : undefined,
    };
  }

  if (record.sealed !== undefined) {
    const sealed = assertRecord(record.sealed, 'bidding.sealed');
    if (sealed.revealTime !== undefined && typeof sealed.revealTime !== 'number') {
      throw new Error('bidding.sealed.revealTime must be a number');
    }
    settings.sealed = {
      revealTime: typeof sealed.revealTime === 'number' ? sealed.revealTime : undefined,
    };
  }

  if (record.reverse !== undefined) {
    const reverse = assertRecord(record.reverse, 'bidding.reverse');
    const starting = reverse.startingPrice;
    if (starting !== undefined && typeof starting !== 'string' && typeof starting !== 'number') {
      throw new Error('bidding.reverse.startingPrice must be a string or number');
    }
    const decrement = reverse.minDecrement;
    if (decrement !== undefined && typeof decrement !== 'string' && typeof decrement !== 'number') {
      throw new Error('bidding.reverse.minDecrement must be a string or number');
    }
    settings.reverse = {
      startingPrice: starting !== undefined ? String(starting) : undefined,
      minDecrement: decrement !== undefined ? String(decrement) : undefined,
    };
  }

  if (record.bidDeadline !== undefined && typeof record.bidDeadline !== 'number') {
    throw new Error('bidding.bidDeadline must be a number');
  }
  settings.bidDeadline = typeof record.bidDeadline === 'number' ? record.bidDeadline : undefined;

  if (record.autoSelect !== undefined) {
    const autoSelect = assertRecord(record.autoSelect, 'bidding.autoSelect');
    if (typeof autoSelect.enabled !== 'boolean') {
      throw new Error('bidding.autoSelect.enabled must be a boolean');
    }
    const criteriaValue = String(autoSelect.criteria ?? '');
    if (!['lowest', 'highest_rated', 'best_match'].includes(criteriaValue)) {
      throw new Error('bidding.autoSelect.criteria is invalid');
    }
    settings.autoSelect = {
      enabled: autoSelect.enabled,
      criteria: criteriaValue as AutoSelectCriteria,
    };
  }

  return settings;
}

function parseMilestones(value: unknown): TaskMilestone[] {
  if (!Array.isArray(value)) {
    throw new Error('milestones must be an array');
  }
  return value.map((entry, index) => {
    const record = assertRecord(entry, `milestones[${index}]`);
    const id = requireNonEmpty(String(record.id ?? ''), `milestones[${index}].id`);
    const name = requireNonEmpty(String(record.name ?? ''), `milestones[${index}].name`);
    const percentage = Number(record.percentage ?? NaN);
    if (!Number.isFinite(percentage)) {
      throw new Error(`milestones[${index}].percentage must be a number`);
    }
    const deadline = record.deadline;
    if (deadline !== undefined && typeof deadline !== 'number') {
      throw new Error(`milestones[${index}].deadline must be a number`);
    }
    return {
      id,
      name,
      description: typeof record.description === 'string' ? record.description : undefined,
      deliverables: record.deliverables !== undefined
        ? parseStringArray(record.deliverables, `milestones[${index}].deliverables`)
        : undefined,
      percentage,
      deadline: typeof deadline === 'number' ? deadline : undefined,
      status: typeof record.status === 'string' ? record.status : undefined,
    };
  });
}

export function parseTaskMarketData(value: unknown): TaskMarketData {
  const record = assertRecord(value, 'marketData');
  const taskTypeValue = String(record.taskType ?? '');
  if (!isTaskType(taskTypeValue)) {
    throw new Error('taskType is invalid');
  }
  const task = assertRecord(record.task, 'task');
  const requirements = requireNonEmpty(String(task.requirements ?? ''), 'task.requirements');
  const deliverables = parseDeliverables(task.deliverables);
  const skills = parseSkills(task.skills);
  const complexityValue = String(task.complexity ?? '');
  if (!isTaskComplexity(complexityValue)) {
    throw new Error('task.complexity is invalid');
  }
  const estimatedDuration = Number(task.estimatedDuration ?? NaN);
  if (!Number.isFinite(estimatedDuration)) {
    throw new Error('task.estimatedDuration must be a number');
  }
  const timeline = parseTimeline(record.timeline);
  const workerRequirements = record.workerRequirements
    ? parseWorkerRequirements(record.workerRequirements)
    : undefined;
  const bidding = record.bidding ? parseBiddingSettings(record.bidding) : undefined;
  const milestones = record.milestones ? parseMilestones(record.milestones) : undefined;

  return {
    taskType: taskTypeValue,
    task: {
      requirements,
      deliverables,
      skills,
      complexity: complexityValue,
      estimatedDuration,
    },
    timeline,
    workerRequirements,
    bidding,
    milestones,
  };
}

export async function createTaskListingPublishEnvelope(
  params: TaskListingPublishEventParams,
): Promise<EventEnvelope> {
  const marketData = parseTaskMarketData(params.marketData);
  return createMarketListingPublishEnvelope({
    ...params,
    marketType: 'task',
    marketData,
  });
}
