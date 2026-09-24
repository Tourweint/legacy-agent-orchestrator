package org.campus.classroom.controller;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.dto.ClassroomCreateDTO;
import org.campus.classroom.dto.ClassroomUpdateDTO;
import org.campus.classroom.dto.SeatCreateDTO;
import org.campus.classroom.dto.SeatUpdateDTO;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.AdminAuditService;
import org.campus.classroom.service.ClassroomService;
import org.campus.classroom.service.SeatService;
import org.campus.classroom.vo.ClassroomVO;
import org.campus.classroom.vo.SeatVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/admin/classrooms")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminClassroomController {
    private final ClassroomService classroomService;
    private final SeatService seatService;
    private final AdminAuditService adminAuditService;

    @PostMapping
    public Result<ClassroomVO> create(@RequestBody @Valid ClassroomCreateDTO request,
                                      @AuthenticationPrincipal LoginUser loginUser) {
        Long id = classroomService.create(request);
        ClassroomVO classroomVO = classroomService.getClassroomById(id);
        adminAuditService.log(
                loginUser.getId(),
                loginUser.getUsername(),
                "CLASSROOM_CREATE",
                "CLASSROOM",
                classroomVO.getId(),
                classroomVO.getBuilding() + " " + classroomVO.getRoomNumber(),
                "status=" + classroomVO.getStatus() + ", capacity=" + classroomVO.getCapacity()
        );
        return Result.success("教室创建成功", classroomVO);
    }

    @PutMapping("/{id}")
    public Result<ClassroomVO> update(@PathVariable Long id,
                                      @RequestBody @Valid ClassroomUpdateDTO request,
                                      @AuthenticationPrincipal LoginUser loginUser) {
        classroomService.update(id, request);
        ClassroomVO classroomVO = classroomService.getClassroomById(id);
        adminAuditService.log(
                loginUser.getId(),
                loginUser.getUsername(),
                "CLASSROOM_UPDATE",
                "CLASSROOM",
                classroomVO.getId(),
                classroomVO.getBuilding() + " " + classroomVO.getRoomNumber(),
                "status=" + classroomVO.getStatus() + ", capacity=" + classroomVO.getCapacity()
        );
        return Result.success("教室信息更新成功", classroomVO);
    }

    @PostMapping("/{id}/seat_layout")
    public Result<Void> createSeatLayout(@PathVariable Long id) {
        seatService.initSeats(id);
        return Result.success("座位布局初始化成功，已自动补齐缺失座位");
    }

    @PostMapping("/{id}/seats")
    public Result<SeatVO> createSeat(@PathVariable Long id, @RequestBody @Valid SeatCreateDTO request) {
        return Result.success("座位创建成功", seatService.create(id, request));
    }

    @PatchMapping("/{id}/seat_layout")
    public Result<Void> batchUpdateSeats(@PathVariable Long id, @RequestBody @Valid SeatUpdateDTO request) {
        seatService.batchUpdateSeats(id, request);
        return Result.success("座位状态更新成功");
    }

    @GetMapping("/list")
    public Result<List<ClassroomVO>> list(@NotNull String building,
                                          @NotNull @RequestParam("min_capacity") Integer minCapacity,
                                          @NotNull String status) {
        return Result.success("获取成功", classroomService.adminGetClassroomList(building, minCapacity, status));
    }

    @DeleteMapping("/{id}/seat_layout")
    public Result<Void> batchDeleteSeats(@PathVariable Long id) {
        seatService.batchDeleteSeats(id);
        return Result.success("座位布局删除成功");
    }
}
