package org.campus.classroom.exception;

import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.common.Result;
import org.campus.classroom.enums.ResultCode;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.time.format.DateTimeParseException;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public Result<String> handleHttpMediaTypeNotSupportedException(HttpMediaTypeNotSupportedException e) {
        log.error("媒体类型错误: {}", e.getMessage());
        return Result.fail(ResultCode.BAD_REQUEST, "请使用 JSON 格式请求");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public Result<String> handleHttpRequestMethodNotSupportedException(HttpRequestMethodNotSupportedException e) {
        log.error("请求类型错误: {}", e.getMessage());
        return Result.fail(ResultCode.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public Result<String> handleNoResourceFoundException(NoResourceFoundException e) {
        log.error("请求的资源不存在: {}", e.getMessage());
        return Result.fail(ResultCode.NOT_FOUND, "请求的资源不存在");
    }

    @ExceptionHandler(AuthorizationDeniedException.class)
    public Result<String> handleAuthorizationDeniedException(AuthorizationDeniedException e) {
        return Result.fail(ResultCode.FORBIDDEN, "无权限访问");
    }

    @ExceptionHandler(ExpiredJwtException.class)
    public Result<String> handleExpiredJwtException(ExpiredJwtException e) {
        return Result.fail(ResultCode.UNAUTHORIZED, "登录状态已过期，请重新登录");
    }

    @ExceptionHandler(JwtException.class)
    public Result<String> handleJwtException(JwtException e) {
        return Result.fail(ResultCode.UNAUTHORIZED, "无效的登录状态，请重新登录");
    }

    @ExceptionHandler(BadCredentialsException.class)
    public Result<String> handleBadCredentialsException(BadCredentialsException e) {
        return Result.fail(ResultCode.UNAUTHORIZED, "认证失败，请检查用户名和密码");
    }

    @ExceptionHandler(AccessDeniedException.class)
    public Result<String> handleAccessDeniedException(AccessDeniedException e) {
        return Result.fail(ResultCode.FORBIDDEN, "权限不足，无法访问");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public Result<String> handleJsonParseError(HttpMessageNotReadableException e) {
        Throwable cause = e.getCause();

        if (cause instanceof InvalidFormatException) {
            if (cause.getCause() instanceof DateTimeParseException ||
                    cause.getCause() instanceof java.time.DateTimeException) {
                return Result.fail(ResultCode.BAD_REQUEST, "时间格式错误或时间值非法");
            }
            return Result.fail(ResultCode.BAD_REQUEST, "参数类型不正确");
        }

        return Result.fail(ResultCode.BAD_REQUEST, "请求参数格式不正确");
    }

    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusinessException(BusinessException e) {
        return Result.fail(e.getResultCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleMethodArgumentNotValidException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult()
                .getFieldErrors()
                .stream()
                .findFirst()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .orElse("参数校验失败");

        return Result.fail(ResultCode.BAD_REQUEST, message);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public Result<Void> handleConstraintViolationException(ConstraintViolationException e) {
        String message = e.getConstraintViolations()
                .stream()
                .findFirst()
                .map(ConstraintViolation::getMessage)
                .orElse("参数校验失败");

        return Result.fail(ResultCode.BAD_REQUEST, message);
    }

    @ExceptionHandler(Exception.class)
    public Result<Void> handleException(Exception e) {
        log.error(e.getMessage(), e);
        return Result.fail(ResultCode.INTERNAL_ERROR, "系统内部错误");
    }
}
