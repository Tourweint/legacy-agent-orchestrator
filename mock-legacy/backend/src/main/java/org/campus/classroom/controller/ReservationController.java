package org.campus.classroom.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.dto.ClassroomReservationCreateDTO;
import org.campus.classroom.dto.SeatReservationCreateDTO;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.AttendanceService;
import org.campus.classroom.service.ReservationService;
import org.campus.classroom.vo.ReservationVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/reservations")
@RequiredArgsConstructor
public class ReservationController {
    private final ReservationService reservationService;
    private final AttendanceService attendanceService;

    @PostMapping("/seats")
    @PreAuthorize("hasRole('STUDENT')")
    public Result<Long> createSeatReservation(@RequestBody @Valid SeatReservationCreateDTO request,
                                              @AuthenticationPrincipal LoginUser loginUser) {
        Long reservationId = reservationService.createSeatReservation(loginUser.getId(), request);
        return Result.success("预约座位成功", reservationId);
    }

    @PostMapping("/classrooms")
    @PreAuthorize("hasRole('TEACHER')")
    public Result<Long> createClassroomReservation(@RequestBody @Valid ClassroomReservationCreateDTO request,
                                                   @AuthenticationPrincipal LoginUser loginUser) {
        Long reservationId = reservationService.createClassroomReservation(loginUser.getId(), request);
        return Result.success("预约教室成功", reservationId);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('STUDENT', 'TEACHER')")
    public Result<Void> cancelReservation(@PathVariable Long id, @AuthenticationPrincipal LoginUser loginUser) {
        reservationService.cancelReservation(loginUser.getId(), id);
        return Result.success("取消预约成功");
    }

    @PostMapping("/{id}/check-in")
    @PreAuthorize("hasRole('STUDENT')")
    public Result<Void> checkIn(@PathVariable Long id, @AuthenticationPrincipal LoginUser loginUser) {
        attendanceService.checkIn(loginUser.getId(), id);
        return Result.success("签到成功");
    }

    @GetMapping()
    @PreAuthorize("hasAnyRole('STUDENT', 'TEACHER')")
    public Result<List<ReservationVO>> listUserAvailableReservations(@AuthenticationPrincipal LoginUser loginUser) {
        List<ReservationVO> reservationVOList = reservationService.listUserAvailableReservations(loginUser.getId());
        return Result.success("查询可用预约列表成功", reservationVOList);
    }

    @GetMapping("/history")
    @PreAuthorize("hasAnyRole('STUDENT', 'TEACHER')")
    public Result<List<ReservationVO>> listUserDisableReservations(@AuthenticationPrincipal LoginUser loginUser) {
        List<ReservationVO> reservationVOList = reservationService.listUserHistoryReservations(loginUser.getId());
        return Result.success("查询历史预约列表成功", reservationVOList);
    }
}
