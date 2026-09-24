package org.campus.classroom.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class SeatUpdateDTO {
    @Pattern(regexp = "ENABLED|DISABLED", message = "状态只能是启用或禁用")
    private String status;

    @Size(max = 255, message = "备注长度不能超过255")
    private String remark;
}
