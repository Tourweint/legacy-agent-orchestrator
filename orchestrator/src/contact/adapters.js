// 协议适配器 —— 吸收存量系统的协议异构（基线 §8.2 清单），异构知识只允许出现在本文件：
//   · 业务结果全在 body.code（HTTP 状态码只承载认证层）——envelope 统一提取
//   · 字段命名混用：请求侧 classroom_id/start_time（snake）、resourceType（camel）、
//     MaintenanceCreateDTO 同一请求体两种混用；响应侧全 camel（源码已核实）
//   · 时间语义不对称：请求 OffsetDateTime 需带 Z，响应 LocalDateTime 无时区（按 UTC 解释，
//     经 canonical/time.js——本文件不做时区判断，只调用口径模块）
//   · keyword 参数语义模糊（实测命中 user_id/resource_id/reason 三字段），禁止精确过滤——
//     适配器直接拒绝该参数，让它根本没有发出的可能（M3）
//
// 输入是"语义化参数"（绝对时刻用 Date），输出是"归一化数据"（时间字段已是绝对时刻）——
// 上层永远看不到 wire 格式。

import { ContactError } from './contact-error.js'
import { formatLegacyTimestamp, interpretLegacyTimestamp } from '../canonical/time.js'

function requireParam(params, name, message) {
  const value = params?.[name]
  if (value === undefined || value === null || value === '') {
    throw new ContactError(message)
  }
  return value
}

// 时间参数必须是绝对时刻（Date）——语义化契约的一部分；字符串在这里一律拒绝，
// 否则"谁负责解释时区"就会悄悄漂移回调用方
function requireInstant(params, name) {
  const value = requireParam(params, name, `缺少时间参数 ${name}（须为绝对时刻 Date）`)
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ContactError(`时间参数 ${name} 必须是绝对时刻（Date），收到: ${String(value)}`)
  }
  return value
}

function z(instant) {
  return formatLegacyTimestamp(instant)
}

function parseLegacyInstant(value) {
  return value === null || value === undefined ? null : interpretLegacyTimestamp(value)
}

function pathFrom(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key]
    if (value === undefined || value === null) throw new ContactError(`路径参数缺失: ${key}`)
    return encodeURIComponent(String(value))
  })
}

export class ProtocolAdapters {
  constructor({ configStore }) {
    this.store = configStore
  }

  /**
   * 按注册表声明构造 wire 请求。
   * @returns {{method: string, path: string, query?: object, body?: object, headers?: object}}
   */
  buildRequest(iface, params = {}) {
    const build = this.#builders[iface.adapter]
    if (!build) {
      throw new ContactError(`未知的适配器: ${iface.adapter}（接口 ${iface.id}）——注册表 adapter 字段必须有落点`)
    }
    const built = build.call(this, params)
    return { method: iface.method, path: pathFrom(iface.path, built.pathVars ?? {}), ...built.rest }
  }

  /**
   * 从传输结果提取协议级信号（供判定规则表消费；不在此判成败）。
   * businessCode === null 表示 envelope 缺失/形状不符（对应 W6）。
   */
  extractSignals(transportResult) {
    if (transportResult.kind !== 'response' && transportResult.kind !== 'unparseable') {
      return { transportKind: transportResult.kind, httpStatus: null, businessCode: null, hasData: false, data: undefined, bodyText: '' }
    }
    if (transportResult.kind === 'unparseable') {
      return { transportKind: 'unparseable', httpStatus: transportResult.httpStatus, businessCode: null, hasData: false, data: undefined, bodyText: transportResult.bodyText ?? '' }
    }
    const json = transportResult.json
    const isEnvelope = json !== null && typeof json === 'object' && !Array.isArray(json)
    const businessCode = isEnvelope && typeof json.code === 'number' ? json.code : null
    return {
      transportKind: 'response',
      httpStatus: transportResult.httpStatus,
      businessCode,
      hasData: isEnvelope && json.data !== undefined && json.data !== null,
      message: isEnvelope ? json.message : undefined,
      data: isEnvelope ? json.data : undefined,
      bodyText: transportResult.bodyText ?? '',
    }
  }

  /** 成功（SUCCESS）后把 wire 数据归一化给上层；时间字段全部转绝对时刻。 */
  normalizeData(iface, data) {
    const normalize = this.#normalizers[iface.adapter]
    if (!normalize) return data
    return normalize(data)
  }

  #builders = {
    // 登录（身份池专用）：body 字段名按 openapi LoginDTO（username/password）
    'auth-token': (params) => ({
      pathVars: {},
      rest: { body: { username: requireParam(params, 'username', '登录缺少 username'), password: requireParam(params, 'password', '登录缺少 password') } },
    }),

    'classroom-detail': (params) => ({
      pathVars: { id: requireParam(params, 'classroomId', '缺少教室 id（classroomId）') },
      rest: {},
    }),

    'classroom-available': (params) => {
      // 两条实测约束做成硬校验（基线 §7.4 #9）：
      //   min_capacity 缺失 → 存量系统返业务码 500；building 不传 → 返空列表（恒假比较）
      // 与其拿到 500/空列表再解释，不如在本地拦截（M3：把不合格的请求挡在存量系统之外）
      requireParam(params, 'building', 'available_list 必须显式传 building（不传会返回空列表，基线实测）')
      requireParam(params, 'minCapacity', 'available_list 必须显式传 minCapacity（缺失时存量系统返业务码 500）')
      return { pathVars: {}, rest: { query: { building: params.building, min_capacity: params.minCapacity } } }
    },

    'seat-list': (params) => ({
      pathVars: { id: requireParam(params, 'classroomId', '缺少教室 id（classroomId）') },
      rest: {},
    }),

    'reserved-seats': (params) => ({
      pathVars: { id: requireParam(params, 'classroomId', '缺少教室 id（classroomId）') },
      rest: { query: { start_time: z(requireInstant(params, 'start')), end_time: z(requireInstant(params, 'end')) } },
    }),

    'maintenance-list': (params) => ({
      pathVars: {},
      rest: { query: params.classroomId !== undefined ? { classroomId: params.classroomId } : {} },
    }),

    'reservation-create': (params) => ({
      // 请求体字段名以源码 @JsonProperty 为准：classroom_id/start_time/end_time（snake）+ reason
      // （openapi.yaml 写的是 camel——上游文档再次与实现不一致，基线 §8.2 已实测在案）
      pathVars: {},
      rest: {
        body: {
          classroom_id: requireParam(params, 'classroomId', '缺少 classroomId'),
          start_time: z(requireInstant(params, 'start')),
          end_time: z(requireInstant(params, 'end')),
          ...(params.reason !== undefined ? { reason: params.reason } : {}),
        },
      },
    }),

    'reservation-seat-create': (params) => ({
      pathVars: {},
      rest: {
        body: {
          seat_id: requireParam(params, 'seatId', '缺少 seatId'),
          start_time: z(requireInstant(params, 'start')),
          end_time: z(requireInstant(params, 'end')),
          ...(params.reason !== undefined ? { reason: params.reason } : {}),
        },
      },
    }),

    'reservation-mine-list': () => ({ pathVars: {}, rest: {} }),

    'reservation-admin-list': (params) => {
      // ★ 查证支点接口：keyword 被实测证明语义模糊（命中 user_id/resource_id/reason 三字段 CAST
      //   模糊匹配），禁止精确过滤——这里直接拒绝，让该参数根本没有发出的可能
      if (params?.keyword !== undefined) {
        throw new ContactError('禁止使用 keyword 过滤预约列表（实测其匹配范围与名字不符，查证须拉全量内存比对）')
      }
      return { pathVars: {}, rest: {} }
    },

    'reservation-cancel': (params) => ({
      pathVars: { id: requireParam(params, 'recordId', '缺少 recordId（要撤销的预约记录 id）') },
      rest: {},
    }),

    'maintenance-create': (params) => ({
      // 命名异构实证（基线 §7.4 #10 / 设计方案第 01 章 §6.5）：同一请求体 camel 与 snake 混用
      pathVars: {},
      rest: {
        body: {
          resourceType: requireParam(params, 'resourceType', '缺少 resourceType'),
          resourceId: requireParam(params, 'resourceId', '缺少 resourceId'),
          start_time: z(requireInstant(params, 'start')),
          end_time: z(requireInstant(params, 'end')),
          ...(params.reason !== undefined ? { reason: params.reason } : {}),
          ...(params.clearConflictingReservations !== undefined
            ? { clear_conflicting_reservations: params.clearConflictingReservations }
            : {}),
        },
      },
    }),
  }

  #normalizers = {
    'classroom-detail': (data) => ({
      classroomId: data?.id,
      building: data?.building,
      roomNumber: data?.roomNumber,
      capacity: data?.capacity,
      status: data?.status,
      seatRows: data?.seatRows,
      seatCols: data?.seatCols,
      remark: data?.remark,
    }),

    'classroom-available': (data) =>
      (Array.isArray(data) ? data : []).map((row) => ({
        classroomId: row?.id,
        building: row?.building,
        roomNumber: row?.roomNumber,
        capacity: row?.capacity,
        status: row?.status,
      })),

    // 座位布局：不在主链路（F2 默认不收集），阶段 2 需要时再按实测形状精化
    'seat-list': (data) => data,

    'reserved-seats': (data) => ({
      // 返回座位 id 数组（读写粒度不一致）——"全量座位=整间被占或维修中"的歧义判定在命题层做
      seatIds: Array.isArray(data) ? data : [],
      occupiedSeatCount: Array.isArray(data) ? data.length : 0,
    }),

    'maintenance-list': (data) =>
      (Array.isArray(data) ? data : []).map((row) => ({
        windowId: row?.id,
        resourceType: row?.resourceType,
        resourceId: row?.resourceId,
        classroomId: row?.classroomId,
        resourceName: row?.resourceName,
        start: parseLegacyInstant(row?.startTime),
        end: parseLegacyInstant(row?.endTime),
        status: row?.status,
        reason: row?.reason,
      })),

    'reservation-admin-list': (data) =>
      (Array.isArray(data) ? data : []).map((row) => ({
        recordId: row?.id,
        userId: row?.userId,
        username: row?.username,
        resourceType: row?.resourceType,
        resourceId: row?.resourceId,
        resourceName: row?.resourceName,
        reserveDate: row?.reserveDate ?? null,
        start: parseLegacyInstant(row?.startTime),
        end: parseLegacyInstant(row?.endTime),
        status: row?.status,
        reason: row?.reason,
      })),

    'reservation-mine-list': (data) =>
      (Array.isArray(data) ? data : []).map((row) => ({
        recordId: row?.id,
        resourceType: row?.resourceType,
        resourceId: row?.resourceId,
        resourceName: row?.resourceName,
        reserveDate: row?.reserveDate ?? null,
        start: parseLegacyInstant(row?.startTime),
        end: parseLegacyInstant(row?.endTime),
        status: row?.status,
        reason: row?.reason,
      })),

    // 创建成功时 data 就是新记录 id（基线 §7.2 实测：{"code":200,"data":115}）
    'reservation-create': (data) => ({ recordId: data ?? null }),
  }
}
