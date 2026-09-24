package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import org.campus.classroom.enums.EmailCodeScene;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.service.EmailCodeService;
import org.campus.classroom.service.MailService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class EmailCodeServiceImpl implements EmailCodeService {
    private static final String EMAIL_CODE_PREFIX = "crs:auth:email-code:";
    private static final String EMAIL_CODE_SEND_PREFIX = "crs:auth:email-code:send:";
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final StringRedisTemplate stringRedisTemplate;
    private final MailService mailService;

    @Value("${app.auth.email-code-expiration-seconds:300}")
    private long emailCodeExpirationSeconds;

    @Value("${app.auth.email-code-resend-seconds:60}")
    private long emailCodeResendSeconds;

    @Override
    public void sendCode(String email, EmailCodeScene scene) {
        String normalizedEmail = normalizeEmail(email);
        String sendKey = buildSendKey(normalizedEmail, scene);
        Boolean allowed = stringRedisTemplate.opsForValue().setIfAbsent(
                sendKey,
                "1",
                emailCodeResendSeconds,
                TimeUnit.SECONDS
        );
        if (!Boolean.TRUE.equals(allowed)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码发送过于频繁，请稍后再试");
        }

        String code = generateCode();
        try {
            mailService.sendVerificationCode(
                    normalizedEmail,
                    code,
                    scene.getDescription(),
                    Math.max(1, TimeUnit.SECONDS.toMinutes(emailCodeExpirationSeconds))
            );
        } catch (RuntimeException e) {
            stringRedisTemplate.delete(sendKey);
            throw e;
        }

        stringRedisTemplate.opsForValue().set(
                buildCodeKey(normalizedEmail, scene),
                code,
                emailCodeExpirationSeconds,
                TimeUnit.SECONDS
        );
    }

    @Override
    public void verifyCode(String email, EmailCodeScene scene, String code) {
        String normalizedEmail = normalizeEmail(email);
        String codeKey = buildCodeKey(normalizedEmail, scene);
        String storedCode = stringRedisTemplate.opsForValue().get(codeKey);
        if (storedCode == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码不存在或已过期");
        }
        if (!storedCode.equals(code)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码错误");
        }
        stringRedisTemplate.delete(codeKey);
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private String buildCodeKey(String email, EmailCodeScene scene) {
        return EMAIL_CODE_PREFIX + scene.getCode() + ":" + email;
    }

    private String buildSendKey(String email, EmailCodeScene scene) {
        return EMAIL_CODE_SEND_PREFIX + scene.getCode() + ":" + email;
    }

    private String generateCode() {
        return String.format("%06d", SECURE_RANDOM.nextInt(1_000_000));
    }
}
