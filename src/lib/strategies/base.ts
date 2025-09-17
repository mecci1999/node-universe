import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import Endpoint from '../registry/endpoint/item';
import Context from '../context';

export default class BaseStrategy {
  public registry: Registry;
  public star: Star;
  public options: GenericObject;

  constructor(registry: Registry, star: Star, options?: GenericObject) {
    this.registry = registry;
    this.star = star;
    this.options = options || {};
  }

  public select(list: Endpoint[], ctx?: Context): Endpoint {
    throw new Error('Not implemented method!');
  }
}
