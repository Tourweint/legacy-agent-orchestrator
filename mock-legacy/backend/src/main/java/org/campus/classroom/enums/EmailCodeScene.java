package org.campus.classroom.enums;

import org.campus.classroom.exception.BusinessException;

public enum EmailCodeScene {
    REGISTER("register", "注册"),
    RESET_PASSWORD("reset", "重置密码"),
    LOGIN("login", "登录");

    private final String code;
    private final String description;

    EmailCodeScene(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public String getCode() {
        return code;
    }

    public String getDescription() {
        return description;
    }

    public static EmailCodeScene fromCode(String code) {
        for (EmailCodeScene scene : values()) {
            if (scene.code.equalsIgnoreCase(code)) {
                return scene;
            }
        }
        throw new BusinessException(ResultCode.BAD_REQUEST, "不支持的验证码场景");
    }
}
