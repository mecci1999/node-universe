import { UniverseError, ServiceSchemaError } from '@/lib/error';
import { UniverseErrorCode, UniverseErrorOptionsType } from '@/typings/error';
import { LoggerInstance } from '@/typings/logger';

/**
 * 增强的错误处理工具类
 * 提供详细的错误上下文和用户友好的错误信息
 */
export class EnhancedErrorHandler {
  private static readonly ERROR_CONTEXT_MAP = new Map<string, string>([
    ['SERVICE_SCHEMA_ERROR', '服务模式配置错误'],
    ['SERVICE_NOT_FOUND', '服务未找到'],
    ['ACTION_NOT_FOUND', '动作未找到'],
    ['EVENT_NOT_FOUND', '事件未找到'],
    ['VALIDATION_ERROR', '参数验证失败'],
    ['TIMEOUT_ERROR', '操作超时'],
    ['DEPENDENCY_ERROR', '依赖服务错误']
  ]);

  /**
   * 创建带有详细上下文的服务模式错误
   */
  static createServiceSchemaError(
    message: string,
    context: {
      serviceName?: string;
      schemaProperty?: string;
      expectedType?: string;
      actualValue?: any;
      suggestions?: string[];
    } = {},
    logger?: LoggerInstance
  ): ServiceSchemaError {
    const enhancedMessage = this.buildEnhancedMessage(message, context);
    const error = new ServiceSchemaError(enhancedMessage, context);
    
    if (logger) {
      logger.error('Service Schema Error:', {
        message: enhancedMessage,
        context,
        stack: error.stack
      });
    }
    
    return error;
  }

  /**
   * 创建带有详细上下文的Universe错误
   */
  static createUniverseError(
    message: string,
    code: UniverseErrorCode,
    type: UniverseErrorOptionsType,
    context: {
      serviceName?: string;
      actionName?: string;
      eventName?: string;
      nodeId?: string;
      requestId?: string;
      timestamp?: number;
      suggestions?: string[];
    } = {},
    logger?: LoggerInstance
  ): UniverseError {
    const enhancedMessage = this.buildEnhancedMessage(message, context);
    const errorData = {
      ...context,
      timestamp: context.timestamp || Date.now(),
      errorType: this.ERROR_CONTEXT_MAP.get(type) || type
    };
    
    const error = new UniverseError(enhancedMessage, code, type, errorData);
    
    if (logger) {
      logger.error('Universe Error:', {
        message: enhancedMessage,
        code,
        type,
        context: errorData,
        stack: error.stack
      });
    }
    
    return error;
  }

  /**
   * 构建增强的错误消息
   */
  private static buildEnhancedMessage(baseMessage: string, context: any): string {
    let enhancedMessage = baseMessage;
    
    // 添加服务上下文
    if (context.serviceName) {
      enhancedMessage += ` [服务: ${context.serviceName}]`;
    }
    
    // 添加动作/事件上下文
    if (context.actionName) {
      enhancedMessage += ` [动作: ${context.actionName}]`;
    }
    
    if (context.eventName) {
      enhancedMessage += ` [事件: ${context.eventName}]`;
    }
    
    // 添加节点信息
    if (context.nodeId) {
      enhancedMessage += ` [节点: ${context.nodeId}]`;
    }
    
    // 添加类型信息
    if (context.expectedType && context.actualValue !== undefined) {
      enhancedMessage += ` [期望类型: ${context.expectedType}, 实际值: ${JSON.stringify(context.actualValue)}]`;
    }
    
    // 添加建议
    if (context.suggestions && context.suggestions.length > 0) {
      enhancedMessage += `\n建议解决方案:\n${context.suggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
    }
    
    return enhancedMessage;
  }

  /**
   * 安全地执行函数，捕获并增强错误
   */
  static async safeExecute<T>(
    fn: () => Promise<T> | T,
    context: {
      operation: string;
      serviceName?: string;
      logger?: LoggerInstance;
    }
  ): Promise<T> {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      const enhancedError = this.enhanceExistingError(error, context);
      throw enhancedError;
    }
  }

  /**
   * 增强现有错误
   */
  private static enhanceExistingError(error: any, context: any): Error {
    if (error instanceof UniverseError || error instanceof ServiceSchemaError) {
      // 已经是增强错误，直接返回
      return error;
    }
    
    const enhancedMessage = `${context.operation}失败: ${error.message}`;
    
    if (context.logger) {
      context.logger.error('Enhanced Error:', {
        operation: context.operation,
        originalError: error.message,
        serviceName: context.serviceName,
        stack: error.stack
      });
    }
    
    // 创建新的增强错误
    const enhancedError = new Error(enhancedMessage);
    enhancedError.stack = error.stack;
    enhancedError.cause = error;
    
    return enhancedError;
  }

  /**
   * 验证必需参数
   */
  static validateRequired(
    value: any,
    paramName: string,
    context: {
      serviceName?: string;
      methodName?: string;
      expectedType?: string;
    } = {}
  ): void {
    if (value === undefined || value === null) {
      throw this.createServiceSchemaError(
        `必需参数 '${paramName}' 不能为空`,
        {
          ...context,
          schemaProperty: paramName,
          actualValue: value,
          suggestions: [
            `请确保传入有效的 ${paramName} 参数`,
            `检查调用方法时是否遗漏了 ${paramName} 参数`,
            context.expectedType ? `参数类型应为: ${context.expectedType}` : ''
          ].filter(Boolean)
        }
      );
    }
  }

  /**
   * 验证类型
   */
  static validateType(
    value: any,
    expectedType: string,
    paramName: string,
    context: {
      serviceName?: string;
      methodName?: string;
    } = {}
  ): void {
    const actualType = typeof value;
    if (actualType !== expectedType) {
      throw this.createServiceSchemaError(
        `参数 '${paramName}' 类型错误`,
        {
          ...context,
          schemaProperty: paramName,
          expectedType,
          actualValue: value,
          suggestions: [
            `将 ${paramName} 转换为 ${expectedType} 类型`,
            `当前类型: ${actualType}, 期望类型: ${expectedType}`,
            '检查参数传递是否正确'
          ]
        }
      );
    }
  }
}

/**
 * 错误恢复策略
 */
export class ErrorRecoveryStrategy {
  /**
   * 重试策略
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      delay?: number;
      backoff?: boolean;
      logger?: LoggerInstance;
      context?: string;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, delay = 1000, backoff = true, logger, context } = options;
    
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          if (logger) {
            logger.error(`${context || 'Operation'} failed after ${maxRetries} attempts:`, {
              error: lastError.message,
              attempts: maxRetries
            });
          }
          throw lastError;
        }
        
        const currentDelay = backoff ? delay * Math.pow(2, attempt - 1) : delay;
        
        if (logger) {
          logger.warn(`${context || 'Operation'} failed, retrying in ${currentDelay}ms (attempt ${attempt}/${maxRetries}):`, {
            error: lastError.message
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, currentDelay));
      }
    }
    
    throw lastError!;
  }

  /**
   * 降级策略
   */
  static async withFallback<T>(
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
    options: {
      logger?: LoggerInstance;
      context?: string;
    } = {}
  ): Promise<T> {
    const { logger, context } = options;
    
    try {
      return await primaryFn();
    } catch (error) {
      if (logger) {
        logger.warn(`${context || 'Primary operation'} failed, using fallback:`, {
          error: (error as Error).message
        });
      }
      
      return await fallbackFn();
    }
  }
}