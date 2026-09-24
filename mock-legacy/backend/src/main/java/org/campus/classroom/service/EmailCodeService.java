package org.campus.classroom.service;

import org.campus.classroom.enums.EmailCodeScene;

public interface EmailCodeService {
    void sendCode(String email, EmailCodeScene scene);

    void verifyCode(String email, EmailCodeScene scene, String code);
}
