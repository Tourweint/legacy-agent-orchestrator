package org.campus.classroom.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class AdminReservationCancelDTO {
    @Size(max = 255, message = "取消原因不能超过255个字符")
    private String reason;
}
