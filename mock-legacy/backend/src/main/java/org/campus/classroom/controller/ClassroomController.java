package org.campus.classroom.controller;

import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.ClassroomService;
import org.campus.classroom.service.ReservationService;
import org.campus.classroom.service.SeatService;
import org.campus.classroom.vo.BuildingPreferenceVO;
import org.campus.classroom.vo.ClassroomSeatLayoutVO;
import org.campus.classroom.vo.ClassroomVO;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/classrooms")
@RequiredArgsConstructor
public class ClassroomController {
    private final ClassroomService classroomService;
    private final ReservationService reservationService;
    private final SeatService seatService;

    @GetMapping("/{id}")
    public Result<ClassroomVO> getClassroomById(@PathVariable @NotNull Long id) {
        return Result.success("查询成功", classroomService.getClassroomById(id));
    }

    @GetMapping("/buildings")
    public Result<List<String>> listBuildings() {
        return Result.success("获取教学楼列表成功", classroomService.listBuildings());
    }

    @GetMapping("/{id}/seats")
    public Result<ClassroomSeatLayoutVO> getClassroomSeatLayout(@PathVariable @NotNull Long id) {
        return Result.success("查询成功", seatService.getSeatLayout(id));
    }

    @GetMapping("/available_list")
    public Result<List<ClassroomVO>> list(@RequestParam(required = false) String building,
                                          @RequestParam("min_capacity") Integer minCapacity) {
        return Result.success("获取成功", classroomService.getAvailableClassroomList(building, minCapacity));
    }

    @GetMapping("/preferred_buildings")
    @PreAuthorize("hasAnyRole('STUDENT', 'TEACHER')")
    public Result<List<BuildingPreferenceVO>> listPreferredBuildings(@AuthenticationPrincipal LoginUser loginUser) {
        return Result.success("获取教学楼偏好成功", classroomService.listPreferredBuildings(loginUser.getId()));
    }

    @GetMapping("/{id}/reserved_seats")
    @PreAuthorize("hasAnyRole('STUDENT', 'TEACHER')")
    public Result<List<Long>> listReservedSeatIds(
            @PathVariable Long id,
            @RequestParam("start_time") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime startTime,
            @RequestParam("end_time") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime endTime,
            @AuthenticationPrincipal LoginUser loginUser) {
        return Result.success(
                "查询已预约座位成功",
                reservationService.listReservedSeatIds(loginUser.getId(), id, startTime, endTime)
        );
    }
}
