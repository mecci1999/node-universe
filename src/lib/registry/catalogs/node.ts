import Star from '@/lib/star';
import Registry from '../registry';
import { LoggerInstance } from '@/typings/logger';
import Node from '../node';
import { getIpList } from '@/utils';
import os from 'os';
import _ from 'lodash';
import { GenericObject } from '@/typings';

/**
 * 节点的目录，统一管理所有的节点
 */
export default class NodeCatalog {
  public registry: Registry;
  public star: Star;
  private logger: LoggerInstance;
  public nodes: Map<string, Node>;
  public localNode: Node | null = null;

  constructor(registry: Registry, star: Star) {
    this.registry = registry;
    this.star = star;
    this.logger = registry.logger;
    this.nodes = new Map();

    // 创建本地节点
    this.createLocalNode();
  }

  public createLocalNode() {
    const node = this.star.nodeID && new Node(this.star.nodeID);
    if (node) {
      node.local = true;
      node.ipList = getIpList();
      node.instanceID = this.star.instanceID;
      node.hostname = os.hostname();
      node.client = {
        type: 'nodejs',
        version: Star.UNIVERSE_VERSION,
        langVersion: process.version // node版本
      };
      node.metadata = this.star.metadata;
      node.seq = 1;
      this.add(node.id, node);
      this.localNode = node;

      return node;
    }
  }

  /**
   * 添加节点
   */
  public add(id: string, node: Node) {
    this.nodes.set(id, node);
  }

  /**
   * 检查节点是否存在
   */
  public has(id: string) {
    return this.nodes.has(id);
  }

  /**
   * 根据id获取节点
   */
  public get(id: string) {
    return this.nodes.get(id);
  }

  /**
   * 删除节点
   */
  public delete(id: string) {
    const node = this.get(id);
    if (node && !node.local) {
      this.registry.unregisterServicesByNode(id);
      this.star.transit?.removePendingRequestByNodeID(id);
    }
    return this.nodes.delete(id);
  }

  /**
   * 获取节点数量
   */
  public count() {
    return this.nodes.size;
  }

  /**
   * 获取有效节点数量
   */
  public onlineCount() {
    let count = 0;
    this.nodes.forEach((node) => {
      if (node.available) count++;
    });

    return count;
  }

  /**
   * 处理节点信息
   */
  public processNodeInfo(payload: GenericObject) {
    const nodeID = payload.sender;
    // 获取节点
    let node = this.get(nodeID);
    let isNew = false;
    let isReconnected = false;

    if (!node) {
      isNew = true;
      node = new Node(nodeID);
      this.add(nodeID, node);
    } else if (!node.available) {
      isReconnected = true;
      node.lastHeartbeatTime = Math.round(process.uptime());
      node.available = true;
      node.offlineSince = null;
    }

    // 更新节点信息
    const needRegister = node.update(payload, isReconnected);
    if (needRegister && node.services) {
      // 注册节点以及节点的服务
      this.registry.registerServices(node, node.services);
    }

    if (isNew) {
      // 广播
      this.star.broadcastLocal('$node.connected', { node, reconnected: false });
      // 日志
      this.logger.info(`Node '${nodeID}' connected.`);
      // 更新指标
    } else if (isReconnected) {
      // 广播
      this.star.broadcastLocal('$node.connected', { node, reconnected: true });
      // 日志
      this.logger.info(`Node '${nodeID} reconnected.'`);
      // 更新指标
    } else {
      // 广播
      this.star.broadcastLocal('$node.updated', { node });
      // 日志
      this.logger.debug(`Node '${nodeID}' updated.`);
    }

    return node;
  }

  /**
   * 节点断开连接
   */
  public disconnected(nodeID: string, isUnexpected: boolean) {
    let node = this.get(nodeID);
    if (node && node.available) {
      node.disconnected();
      // 取消注册该节点的服务
      this.registry.unregisterServicesByNode(node.id);
      // 广播该节点已断开连接
      this.star.broadcastLocal('$node.disconnected', { node, unexpected: !!isUnexpected });
      // 更新指标

      if (isUnexpected) this.logger.warn(`Node '${node.id}' disconnected unexpectedly.`);
      else this.logger.info(`Node '${node.id}' disconnected.`);

      // 移除该节点所有的通信请求
      if (this.star.transit) this.star.transit.removePendingRequestByNodeID(nodeID);
    }
  }

  /**
   * 获取节点列表
   * @param onlyAvaiable 只获取正常运行的
   * @param withServices 只获取带有服务的节点
   */
  public list({ onlyAvaiable = false, withServices = false }: { onlyAvaiable: boolean; withServices: boolean }) {
    let list: Omit<Node, 'rawInfo' | 'services'>[] = [];
    this.nodes.forEach((node) => {
      if (onlyAvaiable && !node.available) return;

      if (withServices) {
        list.push(_.omit(node, ['rawInfo']));
      } else {
        list.push(_.omit(node, ['rawInfo', 'services']));
      }
    });

    return list;
  }

  /**
   * 获得数组形式的节点
   */
  public toArray() {
    return Array.from(this.nodes.values());
  }
}
