package org.campus.classroom.service;

public interface MailService {
    void sendVerificationCode(String email, String code, String sceneDescription, long expireMinutes);
}
