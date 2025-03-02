import { GenericObject } from '@/typings';
import Star from '../star';
import BaseSerializer from './base';
import _ from 'lodash';
import { Encoder } from 'cbor-x';

export default class CborSerializer extends BaseSerializer {
  public encoder: any;
  public options: GenericObject = {};

  constructor(options: GenericObject) {
    super();
    this.options = _.defaultsDeep(options, { useRecords: false, useTag259ForMaps: false });
  }

  public init(star: Star): void {
    super.init(star);

    try {
      this.encoder = new Encoder(this.options);
    } catch (error) {
      this.star?.fatal(
        "The 'cbor-x' package is missing! Please install it with 'npm install cbor-x --save' command!",
        error,
        true
      );
    }
  }

  public serialize(obj: GenericObject, type: string): Buffer {
    const res = this.encoder.encode(obj);

    return res;
  }

  public deserialize(buf: Buffer, type: string): GenericObject {
    const res = this.encoder.decode(buf);

    return res;
  }
}
