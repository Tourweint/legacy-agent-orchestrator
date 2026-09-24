package org.campus.classroom.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.enums.ResultCode;

@Getter
public class BusinessException extends RuntimeException {
    private final ResultCode resultCode;

    public BusinessException(ResultCode resultCode) {
        super(resultCode.getMessage());
        this.resultCode = resultCode;
    }

    public BusinessException(ResultCode resultCode, String message) {
        super(message);
        this.resultCode = resultCode;
    }


}
