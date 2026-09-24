package org.campus.classroom.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class AdminForceLogoutDTO {
    @Size(max = 255, message = "原因长度不能超过255个字符")
    private String reason;
}
