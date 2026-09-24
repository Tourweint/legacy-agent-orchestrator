package org.campus.classroom.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.dto.AdminReservationCancelDTO;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.AdminAuditService;
import org.campus.classroom.service.AdminService;
import org.campus.classroom.vo.AdminReservationVO;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

@RestController
@RequestMapping("/admin/reservations")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminReservationController {
    private final AdminService adminService;
    private final AdminAuditService adminAuditService;

    @GetMapping
    public Result<List<AdminReservationVO>> list(@RequestParam(required = false) String keyword,
                                                 @RequestParam(required = false) String status) {
        return Result.success("获取预约列表成功", adminService.listReservations(keyword, status));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String status) {
        List<AdminReservationVO> reservations = adminService.listReservations(keyword, status);
        byte[] content = buildReservationCsv(reservations).getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename("admin-reservations.csv", StandardCharsets.UTF_8)
                        .build()
                        .toString())
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(content);
    }

    @DeleteMapping("/{id}")
    public Result<Void> cancel(@PathVariable Long id,
                               @RequestBody(required = false) @Valid AdminReservationCancelDTO request,
                               @AuthenticationPrincipal LoginUser loginUser) {
        adminService.cancelReservation(loginUser.getId(), id, request == null ? null : request.getReason());
        adminAuditService.log(
                loginUser.getId(),
                loginUser.getUsername(),
                "RESERVATION_CANCEL",
                "RESERVATION",
                id,
                "reservation#" + id,
                request == null ? null : request.getReason()
        );
        return Result.success("管理员取消预约成功");
    }

    private String buildReservationCsv(List<AdminReservationVO> reservations) {
        StringBuilder csv = new StringBuilder("\uFEFF");
        csv.append("预约ID,用户ID,用户名,昵称,资源类型,资源ID,资源名称,预约日期,开始时间,结束时间,状态,原因,创建时间\n");
        for (AdminReservationVO reservation : reservations) {
            appendRow(csv,
                    reservation.getId(),
                    reservation.getUserId(),
                    reservation.getUsername(),
                    reservation.getNickname(),
                    resourceTypeText(reservation.getResourceType()),
                    reservation.getResourceId(),
                    reservation.getResourceName(),
                    formatDate(reservation.getReserveDate()),
                    formatTime(reservation.getStartTime()),
                    formatTime(reservation.getEndTime()),
                    reservationStatusText(reservation.getStatus()),
                    reservation.getReason(),
                    formatTime(reservation.getCreateTime())
            );
        }
        return csv.toString();
    }

    private void appendRow(StringBuilder csv, Object... values) {
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                csv.append(',');
            }
            csv.append(escapeCsv(values[i]));
        }
        csv.append('\n');
    }

    private String escapeCsv(Object value) {
        String text = value == null ? "" : String.valueOf(value);
        if (text.contains("\"") || text.contains(",") || text.contains("\n") || text.contains("\r")) {
            return "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }

    private String resourceTypeText(String resourceType) {
        if ("SEAT".equals(resourceType)) {
            return "座位";
        }
        if ("CLASSROOM".equals(resourceType)) {
            return "教室";
        }
        return resourceType;
    }

    private String reservationStatusText(String status) {
        if ("ACTIVE".equals(status)) {
            return "进行中";
        }
        if ("CANCELLED".equals(status)) {
            return "已取消";
        }
        if ("EXPIRED".equals(status)) {
            return "已过期";
        }
        return status;
    }

    private String formatDate(LocalDate date) {
        return date == null ? "" : date.toString();
    }

    private String formatTime(LocalDateTime time) {
        return time == null ? "" : time.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }
}
