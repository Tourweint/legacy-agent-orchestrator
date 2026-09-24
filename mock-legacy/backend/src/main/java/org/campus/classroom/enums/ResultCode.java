package org.campus.classroom.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum ResultCode {
    SUCCESS(200, "成功"),

    // 通用错误
    BAD_REQUEST(400, "参数错误"),
    UNAUTHORIZED(401, "未登录"),
    FORBIDDEN(403, "无权限"),
    NOT_FOUND(404, "资源不存在"),
    CONFLICT(409, "资源冲突"),
    INTERNAL_ERROR(500, "系统错误");

    // ===== 业务错误 =====
//    TIME_CONFLICT(40901, "时间冲突"),
//    SEAT_OCCUPIED(40902, "座位已被预约"),
//    CLASSROOM_OCCUPIED(40903, "教室已被预约"),
//
//    RESERVATION_NOT_FOUND(40401, "预约不存在"),
//    SEAT_NOT_FOUND(40402, "座位不存在"),
//
//    INVALID_TIME_RANGE(40001, "时间范围不合法"),
//    INVALID_PARAM(40002, "参数错误");

    private final int code;
    private final String message;
}