import { isFunction, isObject } from '.';
import _ from 'lodash';

/**
 * 性能监控装饰器
 * 监控方法执行时间，识别性能瓶颈
 */
export function performanceMonitor(threshold = 5) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = function (...args: any[]) {
      const start = performance.now();
      const result = method.apply(this, args);
      const end = performance.now();
      
      if (end - start > threshold) {
        console.warn(`[Performance] Method ${target.constructor.name}.${propertyName} took ${(end - start).toFixed(2)}ms`);
      }
      
      return result;
    };
  };
}

/**
 * 深拷贝优化工具类
 * 根据对象复杂度智能选择拷贝策略
 */
export class CloneOptimizer {
  /**
   * 检查对象是否包含复杂嵌套结构
   */
  static hasComplexStructure(obj: any): boolean {
    if (!isObject(obj)) return false;
    
    for (const key in obj) {
      const value = obj[key];
      if (isObject(value) || Array.isArray(value)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 智能拷贝：简单对象用浅拷贝，复杂对象用深拷贝
   */
  static smartClone<T>(obj: T): T {
    if (!isObject(obj)) return obj;
    
    // 简单对象使用展开运算符（性能更好）
    if (!this.hasComplexStructure(obj)) {
      return { ...obj as any };
    }
    
    // 复杂对象使用深拷贝
    return _.cloneDeep(obj);
  }

  /**
   * 结构化拷贝：保留函数引用，只拷贝数据部分
   */
  static structuredClone<T extends Record<string, any>>(obj: T, preserveFunctions = true): T {
    if (!isObject(obj)) return obj;
    
    const result = {} as T;
    
    for (const key in obj) {
      const value = obj[key];
      
      if (preserveFunctions && isFunction(value)) {
        // 函数保持引用
        result[key] = value;
      } else if (isObject(value) || Array.isArray(value)) {
        // 嵌套对象/数组进行深拷贝
        result[key] = _.cloneDeep(value);
      } else {
        // 基本类型直接赋值
        result[key] = value;
      }
    }
    
    return result;
  }
}