package org.campus.classroom.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class SeatCreateDTO {
    @NotBlank(message = "座位编号不能为空")
    @Size(max = 50, message = "座位编号长度不能超过50")
    private String seatNumber;

    @NotNull(message = "座位行号不能为空")
    @Min(value = 1, message = "座位行号必须大于0")
    private Integer rowNumber;

    @NotNull(message = "座位列号不能为空")
    @Min(value = 1, message = "座位列号必须大于0")
    private Integer colNumber;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态只能是启用或禁用")
    private String status;

    @Size(max = 255, message = "备注长度不能超过255")
    private String remark;
}
