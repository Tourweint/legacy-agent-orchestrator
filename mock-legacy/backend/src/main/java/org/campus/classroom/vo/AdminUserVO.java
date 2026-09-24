package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AdminUserVO {
    private Long id;
    private String username;
    private String nickname;
    private String email;
    private String role;
    private Integer status;
    private Boolean online;
    private LocalDateTime createTime;
}
