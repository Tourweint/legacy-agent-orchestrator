package org.campus.classroom.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class ClassroomCreateDTO {
    @NotBlank(message = "教室编号不能为空")
    @Size(max = 50, message = "教室编号长度不能超过50")
    private String roomNumber;

    @NotBlank(message = "教室所在楼不能为空")
    @Size(max = 50, message = "教室所在楼长度不能超过50")
    private String building;

    @Min(value = 1, message = "座位行数必须大于0")
    @Max(value = 100, message = "座位行数不能超过100")
    private Integer seatRows;

    @Min(value = 1, message = "座位列数必须大于0")
    @Max(value = 100, message = "座位列数不能超过100")
    private Integer seatCols;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态只能是启用或禁用")
    private String status;

    @Size(max = 255, message = "教室描述长度不能超过255")
    private String remark;
}
