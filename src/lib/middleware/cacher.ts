/**
 * 引入缓存的中间件
 */
import { deprecate, isFunction } from '@/utils';
import Star from '../star';

export default function cacherMiddleware(star: Star) {
  if (star.cacher) {
    // 该星星使用了缓存
    const middleware = star.cacher.middleware();
    if (isFunction(middleware)) {
      // 提示传入函数方式已被废弃，最好使用对象传入
      deprecate('Validator middleware returning a Function is deprecated. Return a middleware object instead.');

      return {
        name: 'Cacher',
        localAction: middleware
      };
    }

    return middleware;
  }

  return null;
}
