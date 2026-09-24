package org.campus.classroom.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class DeviceContextResolver {
    private static final String DEVICE_ID_HEADER = "X-Device-Id";
    private static final String DEVICE_NAME_HEADER = "X-Device-Name";

    public DeviceContext resolve(HttpServletRequest request) {
        String deviceId = request.getHeader(DEVICE_ID_HEADER);
        String deviceName = request.getHeader(DEVICE_NAME_HEADER);
        String userAgent = request.getHeader("User-Agent");

        if (!StringUtils.hasText(deviceId)) {
            deviceId = "unknown-device";
        }
        if (!StringUtils.hasText(deviceName)) {
            deviceName = StringUtils.hasText(userAgent) ? userAgent : "Unknown Device";
        }
        return new DeviceContext(deviceId.trim(), deviceName.trim());
    }
}
