package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import org.campus.classroom.dto.MaintenanceCreateDTO;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.MaintenanceWindow;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.entity.User;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.MaintenanceWindowMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.service.AdminService;
import org.campus.classroom.service.MaintenanceService;
import org.campus.classroom.vo.MaintenanceWindowVO;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MaintenanceServiceImpl implements MaintenanceService {
    private final MaintenanceWindowMapper maintenanceWindowMapper;
    private final ReservationMapper reservationMapper;
    private final ClassroomMapper classroomMapper;
    private final SeatMapper seatMapper;
    private final UserMapper userMapper;
    private final AdminService adminService;

    @Override
    public List<MaintenanceWindowVO> list(String status, String resourceType, Long classroomId) {
        List<MaintenanceWindow> windows = maintenanceWindowMapper.selectAdminList(
                normalize(status),
                normalize(resourceType),
                classroomId
        );
        return buildVOList(windows);
    }

    @Override
    @Transactional
    public Long create(Long adminUserId, MaintenanceCreateDTO request) {
        String resourceType = normalizeResourceType(request.getResourceType());
        LocalDateTime startTime = toUtcLocalDateTime(request.getStartTime());
        LocalDateTime endTime = toUtcLocalDateTime(request.getEndTime());
        validateTime(startTime, endTime);

        Long classroomId = resolveAndLockClassroomId(resourceType, request.getResourceId());
        List<Reservation> conflicts = findReservationConflicts(
                resourceType,
                request.getResourceId(),
                classroomId,
                startTime,
                endTime
        );
        if (!conflicts.isEmpty() && !Boolean.TRUE.equals(request.getClearConflictingReservations())) {
            throw new BusinessException(ResultCode.CONFLICT, "维护时间段内已有预约，不能创建维护");
        }
        validateNoMaintenanceConflict(resourceType, request.getResourceId(), classroomId, startTime, endTime);

        MaintenanceWindow maintenanceWindow = new MaintenanceWindow();
        maintenanceWindow.setResourceType(resourceType);
        maintenanceWindow.setResourceId(request.getResourceId());
        maintenanceWindow.setClassroomId(classroomId);
        maintenanceWindow.setStartTime(startTime);
        maintenanceWindow.setEndTime(endTime);
        maintenanceWindow.setReason(request.getReason());
        maintenanceWindow.setStatus("ACTIVE");
        maintenanceWindow.setCreateBy(adminUserId);
        maintenanceWindowMapper.insert(maintenanceWindow);

        if (!conflicts.isEmpty()) {
            String cancelReason = buildConflictCancelReason(request.getReason());
            for (Reservation conflict : conflicts) {
                adminService.cancelReservation(adminUserId, conflict.getId(), cancelReason);
            }
        }
        return maintenanceWindow.getId();
    }

    @Override
    @Transactional
    public void cancel(Long id) {
        MaintenanceWindow maintenanceWindow = maintenanceWindowMapper.selectById(id);
        if (maintenanceWindow == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "维护记录不存在");
        }
        if (!"ACTIVE".equals(maintenanceWindow.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "仅可取消进行中的维护");
        }
        int rows = maintenanceWindowMapper.cancel(id);
        if (rows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "维护状态已变化，请刷新后重试");
        }
    }

    private Long resolveAndLockClassroomId(String resourceType, Long resourceId) {
        if (ResourceType.CLASSROOM.name().equals(resourceType)) {
            Classroom classroom = classroomMapper.selectByIdForUpdate(resourceId);
            if (classroom == null) {
                throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
            }
            if (!ClassroomStatus.ENABLED.name().equals(classroom.getStatus())) {
                throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
            }
            return classroom.getId();
        }

        Seat seat = seatMapper.selectByIdForUpdate(resourceId);
        if (seat == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "座位不存在");
        }
        if (!SeatStatus.ENABLED.name().equals(seat.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "座位不可用");
        }
        Classroom classroom = classroomMapper.selectByIdForUpdate(seat.getClassroomId());
        if (classroom == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
        }
        if (!ClassroomStatus.ENABLED.name().equals(classroom.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
        }
        return seat.getClassroomId();
    }

    private List<Reservation> findReservationConflicts(String resourceType, Long resourceId, Long classroomId,
                                                       LocalDateTime startTime, LocalDateTime endTime) {
        List<Reservation> conflicts = new ArrayList<>();
        if (ResourceType.CLASSROOM.name().equals(resourceType)) {
            conflicts.addAll(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime));
            conflicts.addAll(reservationMapper.selectSeatConflictsInClassroomForUpdate(classroomId, startTime, endTime));
        } else {
            conflicts.addAll(reservationMapper.selectSeatConflictsForUpdate(resourceId, startTime, endTime));
            conflicts.addAll(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime));
        }
        return conflicts.stream()
                .filter(item -> item.getId() != null)
                .collect(Collectors.toMap(
                        Reservation::getId,
                        Function.identity(),
                        (left, right) -> left,
                        LinkedHashMap::new
                ))
                .values()
                .stream()
                .toList();
    }

    private void validateNoMaintenanceConflict(String resourceType, Long resourceId, Long classroomId,
                                               LocalDateTime startTime, LocalDateTime endTime) {
        if (ResourceType.CLASSROOM.name().equals(resourceType)) {
            if (!maintenanceWindowMapper.selectConflictsInClassroomForUpdate(classroomId, startTime, endTime).isEmpty()) {
                throw new BusinessException(ResultCode.CONFLICT, "该时间段内已有维护安排");
            }
            return;
        }

        if (!maintenanceWindowMapper.selectSeatConflictsForUpdate(resourceId, startTime, endTime).isEmpty()
                || !maintenanceWindowMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime).isEmpty()) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段内已有维护安排");
        }
    }

    private void validateTime(LocalDateTime startTime, LocalDateTime endTime) {
        if (startTime == null || endTime == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "维护时间不能为空");
        }
        if (!endTime.isAfter(startTime)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "结束时间必须晚于开始时间");
        }
        if (startTime.isBefore(LocalDateTime.now(ZoneOffset.UTC))) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "维护开始时间必须晚于当前时间");
        }
    }

    private List<MaintenanceWindowVO> buildVOList(List<MaintenanceWindow> windows) {
        Set<Long> classroomIds = windows.stream()
                .map(MaintenanceWindow::getClassroomId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Set<Long> seatIds = windows.stream()
                .filter(window -> ResourceType.SEAT.name().equals(window.getResourceType()))
                .map(MaintenanceWindow::getResourceId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Set<Long> userIds = windows.stream()
                .map(MaintenanceWindow::getCreateBy)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());

        Map<Long, Classroom> classroomMap = classroomIds.isEmpty()
                ? Collections.emptyMap()
                : classroomMapper.selectByIds(classroomIds).stream()
                .collect(Collectors.toMap(Classroom::getId, Function.identity()));
        Map<Long, Seat> seatMap = seatIds.isEmpty()
                ? Collections.emptyMap()
                : seatMapper.selectByIds(seatIds).stream()
                .collect(Collectors.toMap(Seat::getId, Function.identity()));
        Map<Long, User> userMap = userIds.stream()
                .map(userMapper::selectById)
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(User::getId, Function.identity()));

        return windows.stream()
                .map(window -> toVO(window, classroomMap, seatMap, userMap))
                .toList();
    }

    private MaintenanceWindowVO toVO(MaintenanceWindow window,
                                     Map<Long, Classroom> classroomMap,
                                     Map<Long, Seat> seatMap,
                                     Map<Long, User> userMap) {
        MaintenanceWindowVO vo = new MaintenanceWindowVO();
        BeanUtils.copyProperties(window, vo);
        Classroom classroom = classroomMap.get(window.getClassroomId());
        if (classroom != null) {
            String resourceName = classroom.getBuilding() + " " + classroom.getRoomNumber();
            if (ResourceType.SEAT.name().equals(window.getResourceType())) {
                Seat seat = seatMap.get(window.getResourceId());
                if (seat != null) {
                    resourceName += " " + seat.getSeatNumber();
                }
            }
            vo.setResourceName(resourceName);
        }
        User createBy = userMap.get(window.getCreateBy());
        if (createBy != null) {
            vo.setCreateByUsername(createBy.getUsername());
        }
        return vo;
    }

    private String normalizeResourceType(String resourceType) {
        String normalized = normalize(resourceType);
        if (!ResourceType.CLASSROOM.name().equals(normalized) && !ResourceType.SEAT.name().equals(normalized)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "维护资源类型不正确");
        }
        return normalized;
    }

    private String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim().toUpperCase();
    }

    private String buildConflictCancelReason(String maintenanceReason) {
        if (!StringUtils.hasText(maintenanceReason)) {
            return "资源维护";
        }
        return "资源维护：" + maintenanceReason.trim();
    }

    private LocalDateTime toUtcLocalDateTime(OffsetDateTime dateTime) {
        return dateTime == null ? null : dateTime.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }
}
