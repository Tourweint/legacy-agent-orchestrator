package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.service.MailService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class MailServiceImpl implements MailService {
    private final JavaMailSender mailSender;

    @Value("${app.mail.from:${spring.mail.username:}}")
    private String mailFrom;

    @Override
    public void sendVerificationCode(String email, String code, String sceneDescription, long expireMinutes) {
        SimpleMailMessage message = new SimpleMailMessage();
        if (mailFrom != null && !mailFrom.isBlank()) {
            message.setFrom(mailFrom);
        }
        message.setTo(email);
        message.setSubject("校园教室预约系统 - 邮箱验证码");
        message.setText("""
                您正在进行%s操作。

                验证码：%s
                有效期：%d分钟

                如非本人操作，请忽略此邮件。
                """.formatted(sceneDescription, code, expireMinutes));
        try {
            mailSender.send(message);
        } catch (MailException e) {
            log.error("[发送邮箱验证码失败] email={}, scene={}", email, sceneDescription, e);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "验证码发送失败，请稍后重试");
        }
    }
}
