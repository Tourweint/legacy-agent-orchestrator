package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class SystemConfig {
    private Long id;
    private String configKey;
    private String configValue;
    private String valueType;
    private String category;
    private String configName;
    private String description;
    private Integer editable;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
