package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class NotificationVO {
    private Long id;
    private String type;
    private String title;
    private String content;
    private Integer isRead;
    private LocalDateTime createTime;
}
