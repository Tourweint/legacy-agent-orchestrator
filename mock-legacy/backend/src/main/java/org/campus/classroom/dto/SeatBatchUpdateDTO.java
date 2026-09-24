package org.campus.classroom.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;
import org.campus.classroom.enums.SeatStatus;

import java.util.List;

@Data
public class SeatBatchUpdateDTO {

    @NotEmpty(message = "座位ID列表不能为空")
    private List<Long> seatIds;

    @NotNull(message = "座位状态不能为空")
    private SeatStatus status;

    @Size(max = 255, message = "备注长度不能超过255")
    private String remark;
}