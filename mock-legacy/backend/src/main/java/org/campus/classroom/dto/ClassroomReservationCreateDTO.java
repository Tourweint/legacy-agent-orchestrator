package org.campus.classroom.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.time.OffsetDateTime;

@Data
public class ClassroomReservationCreateDTO {
    @NotNull(message = "教室ID不能为空")
    @JsonProperty("classroom_id")  // 告诉前端传 classroom_id 映射到这个字段
    private Long classroomId;

    @NotNull(message = "开始时间不能为空")
    @JsonProperty("start_time")
    private OffsetDateTime startTime;

    @NotNull(message = "结束时间不能为空")
    @JsonProperty("end_time")
    private OffsetDateTime endTime;

    @Size(max = 255, message = "备注长度不能超过255")
    private String reason;
}
