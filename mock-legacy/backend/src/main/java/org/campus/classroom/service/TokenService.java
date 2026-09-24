package org.campus.classroom.service;

import org.campus.classroom.security.DeviceContext;
import org.campus.classroom.vo.DeviceSessionVO;
import org.springframework.data.util.Pair;

import java.util.List;

public interface TokenService {
    String generateRefreshToken(Long userId, DeviceContext deviceContext);

    Long validateRefreshToken(String refreshToken);

    Pair<Long, String> rotateRefreshToken(String refreshToken, DeviceContext deviceContext);

    void revokeRefreshToken(String refreshToken);

    void revokeAllRefreshTokens(Long userId);

    boolean hasActiveSession(Long userId);

    boolean isDeviceSessionActive(Long userId, String deviceId);

    List<DeviceSessionVO> listDeviceSessions(Long userId);

    void revokeDeviceSession(Long userId, String deviceId);
}
