import { isInheritedClass, isObject, isString } from '@/utils';
import { StarOptionsError } from '../error';
import BaseTransporter from './base';
import NatsTransporter from './nats';
import MqttTransporter from './mqtt';
// import RedisTransporter from './redis';
import KafkaTransporter from './kafka';
import TcpTransporter from './tcp';
import { UniverseErrorOptionsType } from '@/typings/error';

const Transporters = {
  Base: BaseTransporter,
  Tcp: TcpTransporter,
  Kafka: KafkaTransporter,
  Nats: NatsTransporter,
  MQTT: MqttTransporter,
  // Redis: RedisTransporter,
};

/**
 * 根据模块名获得实例
 * @param name
 * @returns
 */
function getByName(name: string) {
  if (!name) return null;

  let instanceName = Object.keys(Transporters).find((key) => key.toLocaleLowerCase() === name.toLocaleLowerCase());

  if (instanceName) return Transporters[instanceName];
}

function resolve(options: object | string) {
  if (isObject(options) && isInheritedClass(options as object, Transporters.Base)) {
    return options;
  } else if (isString(options)) {
    let TransporterClass = getByName(options as string);
    if (TransporterClass) return new TransporterClass();

    if ((options as string).startsWith('nats://')) {
      // TransporterClass = Transporters.Nats;
    } else if ((options as string).startsWith('mqtt://') || (options as string).startsWith('mqtts://')) {
      // TransporterClass = Transporters.MQTT;
    } else if ((options as string).startsWith('redis://') || (options as string).startsWith('rediss://')) {
      // TransporterClass = Transporters.Redis;
    } else if ((options as string).startsWith('kafka://')) {
      TransporterClass = Transporters.Kafka;
    } else if ((options as string).startsWith('tcp://')) {
      TransporterClass = Transporters.Tcp;
    }
    if (TransporterClass) return new TransporterClass(options);
    else
      throw new StarOptionsError(`Invalid transporter type '${options}'.`, {
        type: options as UniverseErrorOptionsType
      });
  } else if (isObject(options)) {
    let TransporterClass = getByName((options as any).type || 'TCP');
    if (TransporterClass) {
      return new TransporterClass(options);
    } else {
      throw new StarOptionsError(`Invalid transporter type '${(options as any).type}.'`, {
        type: options as UniverseErrorOptionsType
      });
    }
  }

  return null;
}

function register(name: string, value: typeof BaseTransporter) {
  Transporters[name] = value;
}

export default Object.assign(Transporters, { resolve, register });
