package org.campus.classroom.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class LoginDTO {
    @NotBlank(message = "用户名不能为空")
//    @Size(min = 6, max = 20, message = "用户名长度必须在6到20之间")
    private String username;

    @NotBlank(message = "密码不能为空")
//    @Size(min = 8, max = 20, message = "密码长度必须在8到20之间")
    private String password;
}
