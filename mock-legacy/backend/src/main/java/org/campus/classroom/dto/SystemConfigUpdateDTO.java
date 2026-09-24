package org.campus.classroom.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class SystemConfigUpdateDTO {
    @NotBlank(message = "配置值不能为空")
    @Size(max = 255, message = "配置值长度不能超过255个字符")
    private String configValue;
}
