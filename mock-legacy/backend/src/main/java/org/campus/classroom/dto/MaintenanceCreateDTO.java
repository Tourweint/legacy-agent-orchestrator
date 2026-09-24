package org.campus.classroom.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.time.OffsetDateTime;

@Data
public class MaintenanceCreateDTO {
    @NotBlank(message = "维护资源类型不能为空")
    private String resourceType;

    @NotNull(message = "维护资源ID不能为空")
    private Long resourceId;

    @NotNull(message = "开始时间不能为空")
    @JsonProperty("start_time")
    private OffsetDateTime startTime;

    @NotNull(message = "结束时间不能为空")
    @JsonProperty("end_time")
    private OffsetDateTime endTime;

    @Size(max = 255, message = "维护原因长度不能超过255")
    private String reason;
    @JsonProperty("clear_conflicting_reservations")
    private Boolean clearConflictingReservations;
}
