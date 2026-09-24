package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class User {
    private Long id;
    private String username;
    private String password;
    private String nickname;
    private String email;
    private String role;
    private Integer status;
    private Integer creditScore;
    private Integer tokenVersion;
    //插入自动生成,取出时需要对应
    private LocalDateTime createTime;
}
