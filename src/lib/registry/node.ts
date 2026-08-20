import { GenericObject } from '@/typings';
import _ from 'lodash';
import { UniverseError } from '../error';
import { compareInstanceEpoch, normalizeInstanceEpoch } from './instance-epoch';

export default class Node {
  public id: string;
  public instanceID: string | null;
  public instanceEpoch: string | null;
  public available: boolean; // 状态是否正常
  public local: boolean;
  public lastHeartbeatTime: number; // 最近一次心跳运行时间
  public config: GenericObject; // 配置项
  public client: GenericObject;
  public metadata: any;
  public ipList: any; // ip
  public port: number | null; // 端口
  public hostname: string | null; // 主域名
  public udpAddress: string | null; // udp地址
  public rawInfo: any;
  public services: Array<any>;
  public cpu: any;
  public cpuSeq: any;
  public seq: number;
  public offlineSince: any;

  constructor(id: string) {
    this.id = id;
    this.instanceID = null;
    this.instanceEpoch = null;
    this.available = true;
    this.local = false;
    this.lastHeartbeatTime = Math.round(process.uptime());
    this.config = {};
    this.client = {};
    this.ipList = null;
    this.port = null;
    this.hostname = null;
    this.udpAddress = null;
    this.rawInfo = null;
    this.services = [];
    this.cpu = null;
    this.cpuSeq = null;
    this.seq = 0;
    this.offlineSince = null;
  }

  /**
   * Delayed INFO packets from an older process generation must never mutate
   * the active node record. Legacy packets remain compatible until a newer
   * process generation is known for the same node ID.
   */
  public isStaleInstanceInfo(payload: GenericObject): boolean {
    return this.isStaleInstanceSignal(payload);
  }

  /**
   * A signal packet may only change an epoch-aware node when it came from the
   * exact active process generation. This protects HEARTBEAT and DISCONNECT
   * from delayed packets emitted by a replaced container.
   */
  public isCurrentInstanceSignal(payload: GenericObject): boolean {
    const incomingEpoch = normalizeInstanceEpoch(payload?.instanceEpoch);
    const currentEpoch = normalizeInstanceEpoch(this.instanceEpoch);
    if (!currentEpoch) return true;

    if (!incomingEpoch) return payload?.instanceID === this.instanceID;

    return payload?.instanceID === this.instanceID && compareInstanceEpoch(incomingEpoch, currentEpoch) === 0;
  }

  /**
   * Identify signals known to belong to an older or incompatible process.
   */
  public isStaleInstanceSignal(payload: GenericObject): boolean {
    const incomingEpoch = normalizeInstanceEpoch(payload?.instanceEpoch);
    const currentEpoch = normalizeInstanceEpoch(this.instanceEpoch);
    if (!currentEpoch) return false;

    if (!incomingEpoch) {
      // During a rolling upgrade an older process can publish its final empty
      // catalog after the new process has registered under the same nodeID.
      // Its instanceID identifies it as a different, legacy process. Keep
      // same-instance legacy packets compatible for mixed-version rollouts.
      return payload?.instanceID !== this.instanceID;
    }

    const comparison = compareInstanceEpoch(incomingEpoch, currentEpoch);
    return comparison < 0 || (comparison === 0 && payload?.instanceID !== this.instanceID);
  }

  /**
   * A newer heartbeat is a hint to re-discover INFO, not permission to mutate
   * the current record before its catalog arrives.
   */
  public hasNewerInstanceSignal(payload: GenericObject): boolean {
    const incomingEpoch = normalizeInstanceEpoch(payload?.instanceEpoch);
    const currentEpoch = normalizeInstanceEpoch(this.instanceEpoch);
    return !!incomingEpoch && !!currentEpoch && compareInstanceEpoch(incomingEpoch, currentEpoch) > 0;
  }

  public hasInstanceEpoch(): boolean {
    return normalizeInstanceEpoch(this.instanceEpoch) !== null;
  }

  /**
   * 更新节点信息
   */
  public update(payload: GenericObject, isReconnected: boolean): boolean {
    if (this.isStaleInstanceInfo(payload)) return false;

    const incomingEpoch = normalizeInstanceEpoch(payload.instanceEpoch);
    const currentEpoch = normalizeInstanceEpoch(this.instanceEpoch);
    const newSeq = payload.seq || 1;
    const instanceIDChanged = payload.instanceID !== this.instanceID;
    const epochAdvanced =
      !!incomingEpoch && (!currentEpoch || compareInstanceEpoch(incomingEpoch, currentEpoch) > 0);
    const needRegister = newSeq > this.seq || isReconnected || instanceIDChanged || epochAdvanced;

    // Do not let a late same-instance packet change the node snapshot without
    // also changing the registered service catalog.
    if (!needRegister) return false;

    this.metadata = payload.metadata;
    this.ipList = payload.ipList;
    this.hostname = payload.hostname;
    this.port = payload.port;
    this.client = payload.client || {};
    this.config = payload.config || {};
    this.services = _.cloneDeep(payload.services);
    this.rawInfo = payload;

    if (incomingEpoch) this.instanceEpoch = incomingEpoch;

    this.instanceID = payload.instanceID;
    this.seq = newSeq;

    // A legacy process that changes instanceID cannot be ordered safely.
    if (!incomingEpoch && instanceIDChanged) this.instanceEpoch = null;

    return true;
  }

  /**
   * 更新节点回调
   */
  public updateLocalInfo(cpuUsage: any): Promise<any> {
    if (!cpuUsage) {
      return Promise.reject(new UniverseError('registry module unpdateLocalInfo error, cpuUsage is not function.'));
    }

    return cpuUsage()
      .then((res) => {
        const newVal = Math.round(res.avg);
        if (this.cpu != newVal) {
          this.cpu = newVal;
          this.cpuSeq++;
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }

  /**
   * 心跳
   */
  public heartbeat(payload: GenericObject) {
    // 收到心跳，更新节点状态
    if (!this.available) {
      this.available = true;
      this.offlineSince = null;
    }

    if (payload.cpu != null) {
      this.cpu = payload.cpu;
      this.cpuSeq = payload?.cpuSeq || 1;
    }

    this.lastHeartbeatTime = Math.round(process.uptime());
  }

  /**
   * 断开连接
   */
  public disconnected() {
    if (this.available) {
      this.offlineSince = Math.round(process.uptime());
      this.seq++;
    }

    this.available = false;
  }
}
