/**
 * 类型验证和运行时类型检查工具
 */

// 基础类型定义
export interface ServiceSchema {
  name: string;
  version?: string;
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
  mixins?: any[];
  dependencies?: string[];
  methods?: Record<string, MethodDefinition>;
  actions?: Record<string, ActionDefinition>;
  events?: Record<string, EventDefinition>;
  created?: () => void;
  started?: () => void;
  stopped?: () => void;
}

export interface MethodDefinition {
  handler: Function;
  params?: Record<string, any>;
  cache?: boolean | Record<string, any>;
  [key: string]: any;
}

export interface ActionDefinition {
  handler: Function;
  params?: Record<string, any>;
  cache?: boolean | Record<string, any>;
  rest?: string | Record<string, any>;
  visibility?: 'public' | 'protected' | 'private';
  [key: string]: any;
}

export interface EventDefinition {
  handler: Function | Function[];
  params?: Record<string, any>;
  group?: string;
  [key: string]: any;
}

// 运行时类型验证器
export class TypeValidator {
  /**
   * 验证服务模式的基本结构
   */
  static validateServiceSchema(schema: any): schema is ServiceSchema {
    if (!schema || typeof schema !== 'object') {
      return false;
    }

    // 必须有name属性且为字符串
    if (!schema.name || typeof schema.name !== 'string') {
      return false;
    }

    // 验证可选属性的类型
    if (schema.version !== undefined && typeof schema.version !== 'string') {
      return false;
    }

    if (schema.settings !== undefined && (typeof schema.settings !== 'object' || schema.settings === null)) {
      return false;
    }

    if (schema.metadata !== undefined && (typeof schema.metadata !== 'object' || schema.metadata === null)) {
      return false;
    }

    if (schema.mixins !== undefined && !Array.isArray(schema.mixins)) {
      return false;
    }

    if (schema.dependencies !== undefined && !Array.isArray(schema.dependencies)) {
      return false;
    }

    return true;
  }

  /**
   * 验证方法定义
   */
  static validateMethodDefinition(methodDef: any): methodDef is MethodDefinition {
    if (!methodDef || typeof methodDef !== 'object') {
      return false;
    }

    if (typeof methodDef.handler !== 'function') {
      return false;
    }

    if (methodDef.params !== undefined && (typeof methodDef.params !== 'object' || methodDef.params === null)) {
      return false;
    }

    return true;
  }

  /**
   * 验证动作定义
   */
  static validateActionDefinition(actionDef: any): actionDef is ActionDefinition {
    if (!actionDef || typeof actionDef !== 'object') {
      return false;
    }

    if (typeof actionDef.handler !== 'function') {
      return false;
    }

    if (actionDef.visibility !== undefined && 
        !['public', 'protected', 'private'].includes(actionDef.visibility)) {
      return false;
    }

    return true;
  }

  /**
   * 验证事件定义
   */
  static validateEventDefinition(eventDef: any): eventDef is EventDefinition {
    if (!eventDef || typeof eventDef !== 'object') {
      return false;
    }

    const handler = eventDef.handler;
    if (typeof handler !== 'function' && !Array.isArray(handler)) {
      return false;
    }

    if (Array.isArray(handler) && !handler.every(h => typeof h === 'function')) {
      return false;
    }

    return true;
  }

  /**
   * 验证服务名称格式
   */
  static validateServiceName(name: string): boolean {
    if (typeof name !== 'string' || name.length === 0) {
      return false;
    }

    // 服务名称应该只包含字母、数字、点号、下划线、美元符号和连字符
    const namePattern = /^[a-zA-Z0-9._$-]+$/;
    return namePattern.test(name);
  }

  /**
   * 验证版本号格式
   */
  static validateVersion(version: string): boolean {
    if (typeof version !== 'string') {
      return false;
    }

    // 简单的语义版本验证
    const versionPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    return versionPattern.test(version);
  }

  /**
   * 深度验证对象结构
   */
  static deepValidateObject(obj: any, expectedStructure: Record<string, string>): boolean {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    for (const [key, expectedType] of Object.entries(expectedStructure)) {
      if (obj[key] !== undefined) {
        const actualType = typeof obj[key];
        if (actualType !== expectedType) {
          return false;
        }
      }
    }

    return true;
  }
}

// 类型守卫函数
export function isServiceSchema(value: any): value is ServiceSchema {
  return TypeValidator.validateServiceSchema(value);
}

export function isMethodDefinition(value: any): value is MethodDefinition {
  return TypeValidator.validateMethodDefinition(value);
}

export function isActionDefinition(value: any): value is ActionDefinition {
  return TypeValidator.validateActionDefinition(value);
}

export function isEventDefinition(value: any): value is EventDefinition {
  return TypeValidator.validateEventDefinition(value);
}

// 运行时断言函数
export function assertServiceSchema(value: any, context?: string): asserts value is ServiceSchema {
  if (!TypeValidator.validateServiceSchema(value)) {
    throw new Error(`Invalid service schema${context ? ` in ${context}` : ''}`);
  }
}

export function assertMethodDefinition(value: any, context?: string): asserts value is MethodDefinition {
  if (!TypeValidator.validateMethodDefinition(value)) {
    throw new Error(`Invalid method definition${context ? ` in ${context}` : ''}`);
  }
}

export function assertActionDefinition(value: any, context?: string): asserts value is ActionDefinition {
  if (!TypeValidator.validateActionDefinition(value)) {
    throw new Error(`Invalid action definition${context ? ` in ${context}` : ''}`);
  }
}

export function assertEventDefinition(value: any, context?: string): asserts value is EventDefinition {
  if (!TypeValidator.validateEventDefinition(value)) {
    throw new Error(`Invalid event definition${context ? ` in ${context}` : ''}`);
  }
}