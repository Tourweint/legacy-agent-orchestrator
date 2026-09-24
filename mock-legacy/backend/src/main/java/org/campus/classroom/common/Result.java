package org.campus.classroom.common;

import lombok.AllArgsConstructor;
import lombok.Data;
import org.campus.classroom.enums.ResultCode;

@Data
@AllArgsConstructor
public class Result<T> {

    private int code;
    private String message;
    private T data;

    //默认无返回数据成功
    public static <T> Result<T> success() {
        return new Result<>(ResultCode.SUCCESS.getCode(), ResultCode.SUCCESS.getMessage(), null);
    }
    //默认有返回数据成功
    public static <T> Result<T> success(T data) {
        return new Result<>(ResultCode.SUCCESS.getCode(), ResultCode.SUCCESS.getMessage(), data);
    }

    //自定义信息无返回数据成功
    public static <T> Result<T> success(String message) {
        return new Result<>(ResultCode.SUCCESS.getCode(), message, null);
    }

    //自定义信息有返回数据成功
    public static <T> Result<T> success(String message, T data) {
        return new Result<>(ResultCode.SUCCESS.getCode(), message, data);
    }

    //默认失败
    public static <T> Result<T> fail(ResultCode resultCode) {
        return new Result<>(resultCode.getCode(), resultCode.getMessage(), null);
    }

    //自定义消息失败
    public static <T> Result<T> fail(ResultCode resultCode, String message) {
        return new Result<>(resultCode.getCode(), message, null);
    }
}