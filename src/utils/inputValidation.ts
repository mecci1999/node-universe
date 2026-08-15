/**
 * 输入验证和边界条件检查工具
 */

// 验证结果接口
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// 验证规则接口
export interface ValidationRule {
  name: string;
  validator: (value: any) => boolean;
  errorMessage: string;
}

// 输入验证器类
export class InputValidator {
  /**
   * 验证服务名称
   */
  static validateServiceName(name: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // 检查是否为字符串
    if (typeof name !== 'string') {
      result.isValid = false;
      result.errors.push('服务名称必须是字符串类型');
      return result;
    }

    // 检查长度
    if (name.length === 0) {
      result.isValid = false;
      result.errors.push('服务名称不能为空');
    } else if (name.length > 100) {
      result.isValid = false;
      result.errors.push('服务名称长度不能超过100个字符');
    }

    // 检查格式
    const namePattern = /^[a-zA-Z0-9._$-]+$/;
    if (!namePattern.test(name)) {
      result.isValid = false;
      result.errors.push('服务名称只能包含字母、数字、点号、下划线、美元符号和连字符');
    }

    // 检查是否以字母开头
    if (!/^[a-zA-Z]/.test(name)) {
      result.warnings.push('建议服务名称以字母开头');
    }

    // 检查是否包含连续的特殊字符
    if (/[._-]{2,}/.test(name)) {
      result.warnings.push('避免使用连续的特殊字符');
    }

    return result;
  }

  /**
   * 验证版本号
   */
  static validateVersion(version: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (version === undefined || version === null) {
      return result; // 版本号是可选的
    }

    // 支持字符串和数字类型
    if (typeof version !== 'string' && typeof version !== 'number') {
      result.isValid = false;
      result.errors.push('版本号必须是字符串或数字类型');
      return result;
    }

    const versionStr = String(version);

    // 检查语义版本格式
    const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    if (!semverPattern.test(versionStr)) {
      result.warnings.push('建议使用语义版本格式 (如: 1.0.0)');
    }

    return result;
  }

  /**
   * 验证依赖项
   */
  static validateDependencies(dependencies: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (dependencies === undefined || dependencies === null) {
      return result; // 依赖项是可选的
    }

    // 支持字符串、数组或对象
    if (typeof dependencies === 'string') {
      const nameValidation = this.validateServiceName(dependencies);
      if (!nameValidation.isValid) {
        result.isValid = false;
        result.errors.push(`依赖项名称无效: ${nameValidation.errors.join(', ')}`);
      }
    } else if (Array.isArray(dependencies)) {
      if (dependencies.length === 0) {
        result.warnings.push('依赖项数组为空，考虑移除该属性');
      }

      dependencies.forEach((dep, index) => {
        if (typeof dep === 'string') {
          const nameValidation = this.validateServiceName(dep);
          if (!nameValidation.isValid) {
            result.isValid = false;
            result.errors.push(`依赖项[${index}]名称无效: ${nameValidation.errors.join(', ')}`);
          }
        } else if (typeof dep === 'object' && dep !== null) {
          if (!dep.name) {
            result.isValid = false;
            result.errors.push(`依赖项[${index}]缺少name属性`);
          } else {
            const nameValidation = this.validateServiceName(dep.name);
            if (!nameValidation.isValid) {
              result.isValid = false;
              result.errors.push(`依赖项[${index}]名称无效: ${nameValidation.errors.join(', ')}`);
            }
          }
        } else {
          result.isValid = false;
          result.errors.push(`依赖项[${index}]必须是字符串或对象`);
        }
      });
    } else {
      result.isValid = false;
      result.errors.push('依赖项必须是字符串、数组或对象');
    }

    return result;
  }

  /**
   * 验证设置对象
   */
  static validateSettings(settings: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (settings === undefined || settings === null) {
      return result; // 设置是可选的
    }

    if (typeof settings !== 'object' || Array.isArray(settings)) {
      result.isValid = false;
      result.errors.push('设置必须是对象类型');
      return result;
    }

    // 检查设置对象的深度
    const maxDepth = 5;
    if (this.getObjectDepth(settings) > maxDepth) {
      result.warnings.push(`设置对象嵌套层级过深，建议不超过${maxDepth}层`);
    }

    // 检查循环引用
    if (this.hasCircularReference(settings)) {
      result.isValid = false;
      result.errors.push('设置对象包含循环引用');
    }

    return result;
  }

  /**
   * 验证元数据对象
   */
  static validateMetadata(metadata: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (metadata === undefined || metadata === null) {
      return result; // 元数据是可选的
    }

    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      result.isValid = false;
      result.errors.push('元数据必须是对象类型');
      return result;
    }

    // 检查常见的元数据字段
    const recommendedFields = ['description', 'author', 'tags', 'category'];
    const hasRecommendedField = recommendedFields.some(field => metadata[field]);
    if (!hasRecommendedField) {
      result.warnings.push('建议添加描述性元数据字段 (description, author, tags, category)');
    }

    return result;
  }

  /**
   * 验证函数参数
   */
  static validateFunctionParams(params: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (params === undefined || params === null) {
      return result; // 参数是可选的
    }

    if (typeof params !== 'object' || Array.isArray(params)) {
      result.isValid = false;
      result.errors.push('函数参数定义必须是对象类型');
      return result;
    }

    // 验证参数定义的结构
    for (const [paramName, paramDef] of Object.entries(params)) {
      if (typeof paramDef !== 'object' || paramDef === null) {
        result.warnings.push(`参数 ${paramName} 的定义建议使用对象格式`);
        continue;
      }

      const def = paramDef as any;
      
      // 检查类型定义
      if (!def.type) {
        result.warnings.push(`参数 ${paramName} 缺少类型定义`);
      }

      // 检查必需参数
      if (def.required === undefined) {
        result.warnings.push(`参数 ${paramName} 建议明确指定是否必需`);
      }
    }

    return result;
  }

  /**
   * 批量验证
   */
  static validateBatch(validations: Array<() => ValidationResult>): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    for (const validation of validations) {
      const validationResult = validation();
      if (!validationResult.isValid) {
        result.isValid = false;
      }
      result.errors.push(...validationResult.errors);
      result.warnings.push(...validationResult.warnings);
    }

    return result;
  }

  /**
   * 获取对象深度
   */
  private static getObjectDepth(obj: any, depth = 0): number {
    if (depth > 10) return depth; // 防止无限递归
    
    if (typeof obj !== 'object' || obj === null) {
      return depth;
    }

    let maxDepth = depth;
    for (const value of Object.values(obj)) {
      const currentDepth = this.getObjectDepth(value, depth + 1);
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    return maxDepth;
  }

  /**
   * 检查循环引用
   */
  private static hasCircularReference(obj: any, seen = new WeakSet()): boolean {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    if (seen.has(obj)) {
      return true;
    }

    seen.add(obj);

    for (const value of Object.values(obj)) {
      if (this.hasCircularReference(value, seen)) {
        return true;
      }
    }

    seen.delete(obj);
    return false;
  }
}

// 边界条件检查器
export class BoundaryChecker {
  /**
   * 检查数组边界
   */
  static checkArrayBounds(array: any[], index: number): boolean {
    return index >= 0 && index < array.length;
  }

  /**
   * 检查字符串长度边界
   */
  static checkStringLength(str: string, minLength = 0, maxLength = Number.MAX_SAFE_INTEGER): boolean {
    return str.length >= minLength && str.length <= maxLength;
  }

  /**
   * 检查数值范围
   */
  static checkNumberRange(num: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): boolean {
    return num >= min && num <= max && Number.isFinite(num);
  }

  /**
   * 检查对象属性数量
   */
  static checkObjectSize(obj: object, maxProperties = 1000): boolean {
    return Object.keys(obj).length <= maxProperties;
  }

  /**
   * 检查对象深度
   */
  static checkObjectDepth(obj: any, maxDepth = 10): boolean {
    const getDepth = (o: any, depth = 0): number => {
      if (depth > maxDepth) return depth;
      if (typeof o !== 'object' || o === null) return depth;
      
      let maxChildDepth = depth;
      for (const key in o) {
        if (o.hasOwnProperty(key)) {
          const childDepth = getDepth(o[key], depth + 1);
          maxChildDepth = Math.max(maxChildDepth, childDepth);
        }
      }
      return maxChildDepth;
    };
    
    return getDepth(obj) <= maxDepth;
  }

  /**
   * 检查方法数量
   */
  static checkMethodCount(count: number, maxMethods = 50): boolean {
    return count <= maxMethods;
  }

  /**
   * 检查动作数量
   */
  static checkActionCount(count: number, maxActions = 30): boolean {
    return count <= maxActions;
  }

  /**
   * 检查事件数量
   */
  static checkEventCount(count: number, maxEvents = 20): boolean {
    return count <= maxEvents;
  }

  /**
   * 检查内存使用情况（估算）
   */
  static estimateMemoryUsage(obj: any): number {
    const seen = new WeakSet();
    
    function calculateSize(value: any): number {
      if (value === null || value === undefined) return 0;
      
      if (typeof value === 'boolean') return 4;
      if (typeof value === 'number') return 8;
      if (typeof value === 'string') return value.length * 2;
      if (typeof value === 'function') return 0; // 函数大小难以估算
      
      if (typeof value === 'object') {
        if (seen.has(value)) return 0; // 避免循环引用
        seen.add(value);
        
        let size = 0;
        if (Array.isArray(value)) {
          size += value.length * 8; // 数组开销
          for (const item of value) {
            size += calculateSize(item);
          }
        } else {
          const keys = Object.keys(value);
          size += keys.length * 16; // 对象属性开销
          for (const key of keys) {
            size += key.length * 2; // 键名
            size += calculateSize(value[key]); // 值
          }
        }
        return size;
      }
      
      return 0;
    }
    
    return calculateSize(obj);
  }
}

// 安全性检查器
export class SecurityChecker {
  /**
   * 检查潜在的代码注入
   */
  static checkCodeInjection(input: string): ValidationResult {
    const codePatterns: RegExp[] = [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(/gi,
      /setInterval\s*\(/gi,
      /require\s*\(/gi,
      /import\s*\(/gi,
      /__proto__/i,
      /constructor/i,
      /prototype/i
    ];
    
    const errors: string[] = [];
    for (const pattern of codePatterns) {
      if (pattern.test(input)) {
        errors.push(`检测到代码注入模式: ${pattern.source}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  /**
   * 检查XSS攻击模式
   */
  static checkXSS(input: string): ValidationResult {
    const xssPatterns: RegExp[] = [
      /<script[^>]*>.*?<\/script>/gi,
      /<iframe[^>]*>.*?<\/iframe>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<object[^>]*>/i,
      /<embed[^>]*>/i
    ];
    
    const errors: string[] = [];
    for (const pattern of xssPatterns) {
      if (pattern.test(input)) {
        errors.push(`检测到潜在的XSS攻击模式: ${pattern.source}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  /**
   * 检查路径遍历攻击
   */
  static checkPathTraversal(path: string): ValidationResult {
    const traversalPatterns: RegExp[] = [
      /\.\.[\\\//]/g, // ../ or ..\\
      /[\\\//]\.\.[\\\//]/g, // /../ or \..\\
      /%2e%2e%2f/gi, // URL encoded ../
      /%2e%2e%5c/gi  // URL encoded ..\\
    ];
    
    const errors: string[] = [];
    for (const pattern of traversalPatterns) {
      if (pattern.test(path)) {
        errors.push(`检测到路径遍历攻击模式: ${pattern.source}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  /**
   * 检查SQL注入攻击
   */
  static checkSQLInjection(input: string): ValidationResult {
    const sqlPatterns: RegExp[] = [
      /('|(\-\-)|(;)|(\||\|)|(\*|\*))/i,
      /(union|select|insert|delete|update|drop|create|alter|exec|execute)/i
    ];
    
    const errors: string[] = [];
    for (const pattern of sqlPatterns) {
      if (pattern.test(input)) {
        errors.push(`检测到潜在的SQL注入模式: ${pattern.source}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  /**
   * 检查方法安全性
   */
  static checkMethodSecurity(name: string, definition: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 检查方法名称
    const nameCheck = this.checkCodeInjection(name);
    if (!nameCheck.isValid) {
      errors.push(...nameCheck.errors.map(err => `方法名称: ${err}`));
    }
    
    // 检查描述字段
    if (definition.description && typeof definition.description === 'string') {
      const descCheck = this.checkXSS(definition.description);
      if (!descCheck.isValid) {
        errors.push(...descCheck.errors.map(err => `方法描述: ${err}`));
      }
    }
    
    // 检查参数定义
    if (definition.params) {
      const paramsStr = JSON.stringify(definition.params);
      const paramsCheck = this.checkCodeInjection(paramsStr);
      if (!paramsCheck.isValid) {
        errors.push(...paramsCheck.errors.map(err => `参数定义: ${err}`));
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 检查动作安全性
   */
  static checkActionSecurity(name: string, definition: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 检查动作名称
    const nameCheck = this.checkCodeInjection(name);
    if (!nameCheck.isValid) {
      errors.push(...nameCheck.errors.map(err => `动作名称: ${err}`));
    }
    
    // 检查描述字段
    if (definition.description && typeof definition.description === 'string') {
      const descCheck = this.checkXSS(definition.description);
      if (!descCheck.isValid) {
        errors.push(...descCheck.errors.map(err => `动作描述: ${err}`));
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 检查事件安全性
   */
  static checkEventSecurity(name: string, definition: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 检查事件名称
    const nameCheck = this.checkCodeInjection(name);
    if (!nameCheck.isValid) {
      errors.push(...nameCheck.errors.map(err => `事件名称: ${err}`));
    }
    
    // 检查描述字段
    if (definition.description && typeof definition.description === 'string') {
      const descCheck = this.checkXSS(definition.description);
      if (!descCheck.isValid) {
        errors.push(...descCheck.errors.map(err => `事件描述: ${err}`));
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}
