package org.campus.classroom.vo;

import lombok.Data;

@Data
public class DeviceSessionVO {
    private String deviceId;
    private String deviceName;
    private Long loginTime;
}
