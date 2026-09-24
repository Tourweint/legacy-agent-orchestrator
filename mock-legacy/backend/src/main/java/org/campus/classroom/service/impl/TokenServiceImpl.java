package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.security.DeviceContext;
import org.campus.classroom.service.TokenService;
import org.campus.classroom.vo.DeviceSessionVO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.util.Pair;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class TokenServiceImpl implements TokenService {
    private static final String REFRESH_TOKEN_PREFIX = "crs:login:refresh:token:";
    private static final String USER_REFRESH_SET_PREFIX = "crs:login:refresh:user:";
    private static final String USER_DEVICE_HASH_PREFIX = "crs:login:device:user:";
    private static final String USER_DEVICE_ZSET_PREFIX = "crs:login:device:zset:";
    private static final String FIELD_USER_ID = "userId";
    private static final String FIELD_DEVICE_ID = "deviceId";
    private static final String FIELD_DEVICE_NAME = "deviceName";
    private static final String FIELD_LOGIN_TIME = "loginTime";
    private static final String DEVICE_MISMATCH_RESULT = "DEVICE_MISMATCH";
    private static final DefaultRedisScript<String> CREATE_REFRESH_TOKEN_SCRIPT = createRefreshTokenScript();
    private static final DefaultRedisScript<String> ROTATE_REFRESH_TOKEN_SCRIPT = createRotateRefreshTokenScript();

    private final StringRedisTemplate stringRedisTemplate;

    @Value("${jwt.refresh-expiration}")
    private long refreshExpiration;

    @Value("${app.auth.max-device-sessions:3}")
    private int maxDeviceSessions;

    private static DefaultRedisScript<String> createRefreshTokenScript() {
        DefaultRedisScript<String> script = new DefaultRedisScript<>();
        script.setResultType(String.class);
        script.setScriptText("""
                local userId = ARGV[1]
                local deviceId = ARGV[2]
                local deviceName = ARGV[3]
                local loginTime = ARGV[4]
                local ttl = ARGV[5]
                local newTokenHash = ARGV[6]
                local refreshSetKey = ARGV[7] .. userId
                local deviceHashKey = ARGV[8] .. userId
                local deviceZsetKey = ARGV[9] .. userId
                local maxDevices = tonumber(ARGV[10])
                local tokenPrefix = ARGV[11]

                local existingTokenHash = redis.call('HGET', deviceHashKey, deviceId)
                if existingTokenHash then
                    redis.call('DEL', tokenPrefix .. existingTokenHash)
                    redis.call('SREM', refreshSetKey, existingTokenHash)
                else
                    local deviceCount = redis.call('ZCARD', deviceZsetKey)
                    if deviceCount and tonumber(deviceCount) >= maxDevices then
                        local oldestDevice = redis.call('ZRANGE', deviceZsetKey, 0, 0)
                        if oldestDevice[1] then
                            local oldestTokenHash = redis.call('HGET', deviceHashKey, oldestDevice[1])
                            if oldestTokenHash then
                                redis.call('DEL', tokenPrefix .. oldestTokenHash)
                                redis.call('SREM', refreshSetKey, oldestTokenHash)
                            end
                            redis.call('HDEL', deviceHashKey, oldestDevice[1])
                            redis.call('ZREM', deviceZsetKey, oldestDevice[1])
                        end
                    end
                end

                redis.call('HSET', KEYS[1],
                    'userId', userId,
                    'deviceId', deviceId,
                    'deviceName', deviceName,
                    'loginTime', loginTime
                )
                redis.call('PEXPIRE', KEYS[1], ttl)
                redis.call('SADD', refreshSetKey, newTokenHash)
                redis.call('PEXPIRE', refreshSetKey, ttl)
                redis.call('HSET', deviceHashKey, deviceId, newTokenHash)
                redis.call('PEXPIRE', deviceHashKey, ttl)
                redis.call('ZADD', deviceZsetKey, loginTime, deviceId)
                redis.call('PEXPIRE', deviceZsetKey, ttl)
                return ''
                """);
        return script;
    }

    private static DefaultRedisScript<String> createRotateRefreshTokenScript() {
        DefaultRedisScript<String> script = new DefaultRedisScript<>();
        script.setResultType(String.class);
        script.setScriptText("""
                local userId = redis.call('HGET', KEYS[1], 'userId')
                if not userId then
                    return ''
                end
                local deviceId = redis.call('HGET', KEYS[1], 'deviceId')
                if not deviceId then
                    return ''
                end
                local expectedDeviceId = ARGV[3]
                if expectedDeviceId and expectedDeviceId ~= '' and deviceId ~= expectedDeviceId then
                    return 'DEVICE_MISMATCH'
                end
                local deviceName = redis.call('HGET', KEYS[1], 'deviceName')
                local loginTime = redis.call('HGET', KEYS[1], 'loginTime')
                local refreshSetKey = ARGV[5] .. userId
                local deviceHashKey = ARGV[6] .. userId
                local deviceZsetKey = ARGV[7] .. userId

                redis.call('DEL', KEYS[1])
                redis.call('SREM', refreshSetKey, ARGV[1])
                redis.call('HSET', KEYS[2],
                    'userId', userId,
                    'deviceId', deviceId,
                    'deviceName', deviceName or ARGV[4],
                    'loginTime', loginTime or ARGV[8]
                )
                redis.call('PEXPIRE', KEYS[2], ARGV[9])
                redis.call('SADD', refreshSetKey, ARGV[2])
                redis.call('PEXPIRE', refreshSetKey, ARGV[9])
                redis.call('HSET', deviceHashKey, deviceId, ARGV[2])
                redis.call('PEXPIRE', deviceHashKey, ARGV[9])
                redis.call('ZADD', deviceZsetKey, loginTime or ARGV[8], deviceId)
                redis.call('PEXPIRE', deviceZsetKey, ARGV[9])
                return userId
                """);
        return script;
    }

    private String buildTokenKey(String refreshToken) {
        return REFRESH_TOKEN_PREFIX + hashRefreshToken(refreshToken);
    }

    private String buildTokenKeyByHash(String tokenHash) {
        return REFRESH_TOKEN_PREFIX + tokenHash;
    }

    private String buildTokenHash(String refreshToken) {
        return hashRefreshToken(refreshToken);
    }

    private String buildUserRefreshSetKey(Long userId) {
        return USER_REFRESH_SET_PREFIX + userId;
    }

    private String buildUserDeviceHashKey(Long userId) {
        return USER_DEVICE_HASH_PREFIX + userId;
    }

    private String buildUserDeviceZsetKey(Long userId) {
        return USER_DEVICE_ZSET_PREFIX + userId;
    }

    private String requireRefreshToken(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refreshToken 无效或已过期");
        }
        return refreshToken;
    }

    private String hashRefreshToken(String refreshToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(refreshToken.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    @Override
    public String generateRefreshToken(Long userId, DeviceContext deviceContext) {
        String refreshToken = UUID.randomUUID().toString();
        String tokenKey = buildTokenKey(refreshToken);
        String loginTime = String.valueOf(System.currentTimeMillis() / 1000);

        stringRedisTemplate.execute(
                CREATE_REFRESH_TOKEN_SCRIPT,
                List.of(tokenKey),
                userId.toString(),
                deviceContext.deviceId(),
                deviceContext.deviceName(),
                loginTime,
                String.valueOf(refreshExpiration),
                buildTokenHash(refreshToken),
                USER_REFRESH_SET_PREFIX,
                USER_DEVICE_HASH_PREFIX,
                USER_DEVICE_ZSET_PREFIX,
                String.valueOf(maxDeviceSessions),
                REFRESH_TOKEN_PREFIX
        );
        return refreshToken;
    }

    @Override
    public Long validateRefreshToken(String refreshToken) {
        String key = buildTokenKey(requireRefreshToken(refreshToken));
        Object userId = stringRedisTemplate.opsForHash().get(key, FIELD_USER_ID);
        if (userId == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refreshToken 无效或已过期");
        }
        return Long.valueOf(userId.toString());
    }

    @Override
    public Pair<Long, String> rotateRefreshToken(String refreshToken, DeviceContext deviceContext) {
        String validRefreshToken = requireRefreshToken(refreshToken);
        String newRefreshToken = UUID.randomUUID().toString();
        String result = stringRedisTemplate.execute(
                ROTATE_REFRESH_TOKEN_SCRIPT,
                List.of(buildTokenKey(validRefreshToken), buildTokenKey(newRefreshToken)),
                buildTokenHash(validRefreshToken),
                buildTokenHash(newRefreshToken),
                deviceContext.deviceId(),
                deviceContext.deviceName(),
                USER_REFRESH_SET_PREFIX,
                USER_DEVICE_HASH_PREFIX,
                USER_DEVICE_ZSET_PREFIX,
                String.valueOf(System.currentTimeMillis() / 1000),
                String.valueOf(refreshExpiration)
        );
        if (DEVICE_MISMATCH_RESULT.equals(result)) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refreshToken 设备不匹配");
        }
        if (result == null || result.isBlank()) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refreshToken 无效或已过期");
        }
        return Pair.of(Long.valueOf(result), newRefreshToken);
    }

    @Override
    public void revokeRefreshToken(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refreshToken 无效或已过期");
        }
        String key = buildTokenKey(refreshToken);
        Object userIdValue = stringRedisTemplate.opsForHash().get(key, FIELD_USER_ID);
        Object deviceIdValue = stringRedisTemplate.opsForHash().get(key, FIELD_DEVICE_ID);
        if (userIdValue == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refreshToken 无效或已过期");
        }

        Long userId = Long.valueOf(userIdValue.toString());
        stringRedisTemplate.delete(key);
        stringRedisTemplate.opsForSet().remove(buildUserRefreshSetKey(userId), buildTokenHash(refreshToken));
        if (deviceIdValue != null) {
            String deviceId = deviceIdValue.toString();
            stringRedisTemplate.opsForHash().delete(buildUserDeviceHashKey(userId), deviceId);
            stringRedisTemplate.opsForZSet().remove(buildUserDeviceZsetKey(userId), deviceId);
        }
    }

    @Override
    public void revokeAllRefreshTokens(Long userId) {
        String userRefreshSetKey = buildUserRefreshSetKey(userId);
        String userDeviceHashKey = buildUserDeviceHashKey(userId);
        String userDeviceZsetKey = buildUserDeviceZsetKey(userId);
        Set<String> tokenHashes = stringRedisTemplate.opsForSet().members(userRefreshSetKey);

        List<String> keysToDelete = new ArrayList<>();
        keysToDelete.add(userRefreshSetKey);
        keysToDelete.add(userDeviceHashKey);
        keysToDelete.add(userDeviceZsetKey);
        if (tokenHashes != null) {
            for (String tokenHash : tokenHashes) {
                keysToDelete.add(buildTokenKeyByHash(tokenHash));
            }
        }
        stringRedisTemplate.delete(keysToDelete);
    }

    @Override
    public boolean hasActiveSession(Long userId) {
        if (userId == null) {
            return false;
        }
        Long sessionCount = stringRedisTemplate.opsForHash().size(buildUserDeviceHashKey(userId));
        return sessionCount != null && sessionCount > 0;
    }

    @Override
    public boolean isDeviceSessionActive(Long userId, String deviceId) {
        if (userId == null || deviceId == null || deviceId.isBlank()) {
            return false;
        }
        Object tokenHash = stringRedisTemplate.opsForHash().get(buildUserDeviceHashKey(userId), deviceId);
        return tokenHash != null;
    }

    @Override
    public List<DeviceSessionVO> listDeviceSessions(Long userId) {
        Set<ZSetOperations.TypedTuple<String>> deviceTuples =
                stringRedisTemplate.opsForZSet().reverseRangeWithScores(buildUserDeviceZsetKey(userId), 0, -1);
        if (deviceTuples == null || deviceTuples.isEmpty()) {
            return List.of();
        }

        List<DeviceSessionVO> sessions = new ArrayList<>();
        String deviceHashKey = buildUserDeviceHashKey(userId);
        for (ZSetOperations.TypedTuple<String> tuple : deviceTuples) {
            String deviceId = tuple.getValue();
            if (deviceId == null) {
                continue;
            }
            Object tokenHashValue = stringRedisTemplate.opsForHash().get(deviceHashKey, deviceId);
            if (tokenHashValue == null) {
                continue;
            }

            Map<Object, Object> sessionMap = stringRedisTemplate.opsForHash().entries(buildTokenKeyByHash(tokenHashValue.toString()));
            if (sessionMap == null || sessionMap.isEmpty()) {
                continue;
            }

            DeviceSessionVO session = new DeviceSessionVO();
            session.setDeviceId(deviceId);
            Object deviceName = sessionMap.get(FIELD_DEVICE_NAME);
            session.setDeviceName(deviceName == null ? "Unknown Device" : deviceName.toString());

            Object loginTime = sessionMap.get(FIELD_LOGIN_TIME);
            if (loginTime != null) {
                session.setLoginTime(Long.valueOf(loginTime.toString()));
            } else if (tuple.getScore() != null) {
                session.setLoginTime(tuple.getScore().longValue());
            }
            sessions.add(session);
        }
        return sessions;
    }

    @Override
    public void revokeDeviceSession(Long userId, String deviceId) {
        if (deviceId == null || deviceId.isBlank()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "deviceId 不能为空");
        }
        String deviceHashKey = buildUserDeviceHashKey(userId);
        Object tokenHashValue = stringRedisTemplate.opsForHash().get(deviceHashKey, deviceId);
        if (tokenHashValue == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "设备登录记录不存在");
        }

        stringRedisTemplate.delete(buildTokenKeyByHash(tokenHashValue.toString()));
        stringRedisTemplate.opsForSet().remove(buildUserRefreshSetKey(userId), tokenHashValue.toString());
        stringRedisTemplate.opsForHash().delete(deviceHashKey, deviceId);
        stringRedisTemplate.opsForZSet().remove(buildUserDeviceZsetKey(userId), deviceId);
    }
}
