package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.entity.AttendanceRecord;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.entity.User;
import org.campus.classroom.enums.AttendanceStatus;
import org.campus.classroom.enums.ReservationStatus;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.event.SeatReservationReleasedEvent;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.AttendanceMapper;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.service.AdminService;
import org.campus.classroom.service.NotificationService;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.service.TokenService;
import org.campus.classroom.vo.AdminAnalyticsVO;
import org.campus.classroom.vo.AdminBuildingHeatVO;
import org.campus.classroom.vo.AdminClassroomUtilizationVO;
import org.campus.classroom.vo.AdminReservationVO;
import org.campus.classroom.vo.AdminTimeSlotHeatVO;
import org.campus.classroom.vo.AdminUserReservationStatVO;
import org.campus.classroom.vo.AdminUserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class AdminServiceImpl implements AdminService {
    private final UserMapper userMapper;
    private final ReservationMapper reservationMapper;
    private final ClassroomMapper classroomMapper;
    private final SeatMapper seatMapper;
    private final AttendanceMapper attendanceMapper;
    private final NotificationService notificationService;
    private final SystemConfigService systemConfigService;
    private final TokenService tokenService;
    private final ApplicationEventPublisher applicationEventPublisher;

    @Override
    public List<AdminUserVO> listUsers(String keyword, String role, Integer status) {
        return userMapper.selectAdminList(normalize(keyword), normalize(role), status)
                .stream()
                .map(this::toUserVO)
                .toList();
    }

    @Override
    @Transactional
    public AdminUserVO updateUserStatus(Long adminUserId, Long targetUserId, Integer status, String reason) {
        if (Objects.equals(adminUserId, targetUserId)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "管理员不能修改自己的状态");
        }
        User user = getUser(targetUserId);
        if ("ADMIN".equals(user.getRole())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "不能通过此接口修改管理员状态");
        }
        if (Objects.equals(user.getStatus(), status)) {
            return toUserVO(user);
        }
        int updatedRows = userMapper.updateStatus(targetUserId, status);
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "用户状态更新失败，请刷新后重试");
        }

        String title = status == 0 ? "账号已被封禁" : "账号已恢复使用";
        String content = buildUserStatusNotice(status, reason);
        notificationService.createSystemNotification(targetUserId, "USER_STATUS", title, content);

        log.info("[管理员更新用户状态成功] 管理员ID={}, 目标用户ID={}, 新状态={}", adminUserId, targetUserId, status);
        return toUserVO(getUser(targetUserId));
    }

    @Override
    @Transactional
    public AdminUserVO forceLogoutUser(Long adminUserId, Long targetUserId, String reason) {
        if (Objects.equals(adminUserId, targetUserId)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "管理员不能强制下线自己");
        }
        User user = getUser(targetUserId);
        if ("ADMIN".equals(user.getRole())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "不能通过此接口强制下线管理员");
        }

        int updatedRows = userMapper.incrementTokenVersion(targetUserId);
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "用户登录状态更新失败，请刷新后重试");
        }
        tokenService.revokeAllRefreshTokens(targetUserId);
        notificationService.createSystemNotification(
                targetUserId,
                "USER_STATUS",
                "账号已被管理员强制下线",
                buildForceLogoutNotice(reason)
        );
        log.info("[管理员强制下线用户成功] adminUserId={}, targetUserId={}", adminUserId, targetUserId);
        return toUserVO(user);
    }

    @Override
    public List<AdminReservationVO> listReservations(String keyword, String status) {
        List<Reservation> reservations = reservationMapper.selectAdminList(normalize(keyword), normalize(status));
        Set<Long> userIds = reservations.stream().map(Reservation::getUserId).collect(Collectors.toSet());
        Set<Long> classroomIds = reservations.stream().map(Reservation::getClassroomId).collect(Collectors.toSet());
        Set<Long> seatIds = reservations.stream()
                .filter(item -> ResourceType.SEAT.name().equals(item.getResourceType()))
                .map(Reservation::getResourceId)
                .collect(Collectors.toSet());

        Map<Long, User> userMap = userIds.isEmpty()
                ? Collections.emptyMap()
                : userIds.stream()
                .map(userMapper::selectById)
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, Classroom> classroomMap = classroomIds.isEmpty()
                ? Collections.emptyMap()
                : classroomMapper.selectByIds(classroomIds).stream()
                .collect(Collectors.toMap(Classroom::getId, Function.identity()));
        Map<Long, Seat> seatMap = seatIds.isEmpty()
                ? Collections.emptyMap()
                : seatMapper.selectByIds(seatIds).stream()
                .collect(Collectors.toMap(Seat::getId, Function.identity()));

        return reservations.stream()
                .map(item -> toReservationVO(item, userMap, classroomMap, seatMap))
                .filter(item -> matchReservationKeyword(item, keyword))
                .toList();
    }

    @Override
    @Transactional
    public void cancelReservation(Long adminUserId, Long reservationId, String reason) {
        Reservation reservation = reservationMapper.selectById(reservationId);
        if (reservation == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "预约不存在");
        }
        if (!ReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "仅可取消进行中的预约");
        }

        int cancelRows = reservationMapper.adminCancelReservation(reservationId);
        if (cancelRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "预约状态已变化，请刷新后重试");
        }

        Long minusMinutes = Duration.between(reservation.getStartTime(), reservation.getEndTime()).toMinutes();
        int usageRows = reservationMapper.minusUsage(reservation.getUserId(), reservation.getReserveDate(), minusMinutes);
        if (usageRows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "回滚预约额度失败，请联系管理员");
        }

        if (ResourceType.SEAT.name().equals(reservation.getResourceType())) {
            attendanceMapper.insertStatusIfAbsent(reservationId, "CANCELLED");
            attendanceMapper.updateStatusIfPending(reservationId, "CANCELLED");
        }

        notificationService.createSystemNotification(
                reservation.getUserId(),
                "RESERVATION_CANCELLED",
                "预约已被管理员取消",
                buildReservationCancelNotice(reason)
        );

        log.info("[管理员取消预约成功] 管理员ID={}, 预约ID={}", adminUserId, reservationId);
        if (ResourceType.SEAT.name().equals(reservation.getResourceType())) {
            applicationEventPublisher.publishEvent(new SeatReservationReleasedEvent(
                    reservation.getResourceId(),
                    reservation.getStartTime(),
                    reservation.getEndTime()
            ));
        }
    }

    @Override
    public AdminAnalyticsVO getAnalytics(Integer days) {
        Integer normalizedDays = normalizeDays(days);
        LocalDateTime now = utcNow();
        LocalDateTime windowStart = normalizedDays == null ? null : now.minusDays(normalizedDays);

        List<Classroom> classrooms = classroomMapper.selectAll();
        List<User> users = userMapper.selectAdminList(null, null, null);
        List<Reservation> scopedReservations = reservationMapper.selectAll().stream()
                .filter(item -> item.getStartTime() != null)
                .filter(item -> !item.getStartTime().isAfter(now))
                .filter(item -> windowStart == null || !item.getStartTime().isBefore(windowStart))
                .toList();

        Map<Long, Classroom> classroomMap = classrooms.stream()
                .collect(Collectors.toMap(Classroom::getId, Function.identity()));
        Map<Long, User> userMap = users.stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, AttendanceRecord> attendanceMap = scopedReservations.isEmpty()
                ? Collections.emptyMap()
                : attendanceMapper.selectByReservationIds(scopedReservations.stream().map(Reservation::getId).toList())
                .stream()
                .collect(Collectors.toMap(AttendanceRecord::getReservationId, Function.identity()));

        long availableMinutesPerDay = getAvailableMinutesPerDay();
        long windowDayCount = calculateWindowDayCount(normalizedDays, scopedReservations, now);

        Map<Long, ClassroomAccumulator> classroomStats = new HashMap<>();
        Map<String, BuildingAccumulator> buildingStats = new HashMap<>();
        Map<Integer, TimeSlotAccumulator> timeSlotStats = new HashMap<>();
        Map<Long, UserReservationAccumulator> userStats = new HashMap<>();

        long checkedInCount = 0L;
        long noShowCount = 0L;
        long attendableReservationCount = 0L;
        long totalReservedMinutes = 0L;

        for (Reservation reservation : scopedReservations) {
            long durationMinutes = reservationDurationMinutes(reservation);
            totalReservedMinutes += durationMinutes;

            Classroom classroom = classroomMap.get(reservation.getClassroomId());
            if (classroom != null) {
                accumulateClassroom(classroomStats, classroom, reservation, durationMinutes);
                accumulateBuilding(buildingStats, classroom, durationMinutes);
            }

            accumulateTimeSlots(timeSlotStats, reservation);
            accumulateUser(userStats, reservation, userMap.get(reservation.getUserId()), durationMinutes);

            AttendanceRecord attendanceRecord = attendanceMap.get(reservation.getId());
            if (attendanceRecord == null) {
                continue;
            }
            String attendanceStatus = attendanceRecord.getStatus();
            if (AttendanceStatus.CHECKED_IN.name().equals(attendanceStatus)) {
                checkedInCount++;
                attendableReservationCount++;
                UserReservationAccumulator accumulator = userStats.get(reservation.getUserId());
                if (accumulator != null) {
                    accumulator.checkedInCount++;
                }
            } else if (AttendanceStatus.NO_SHOW.name().equals(attendanceStatus)) {
                noShowCount++;
                attendableReservationCount++;
                UserReservationAccumulator accumulator = userStats.get(reservation.getUserId());
                if (accumulator != null) {
                    accumulator.noShowCount++;
                }
            }
        }

        List<AdminClassroomUtilizationVO> classroomUtilizationList = classrooms.stream()
                .map(classroom -> toClassroomUtilizationVO(
                        classroom,
                        classroomStats.get(classroom.getId()),
                        windowDayCount,
                        availableMinutesPerDay
                ))
                .sorted(Comparator
                        .comparing(AdminClassroomUtilizationVO::getUtilizationRate, Comparator.reverseOrder())
                        .thenComparing(AdminClassroomUtilizationVO::getReservationCount, Comparator.reverseOrder())
                        .thenComparing(AdminClassroomUtilizationVO::getBuilding, Comparator.nullsLast(String::compareTo))
                        .thenComparing(AdminClassroomUtilizationVO::getRoomNumber, Comparator.nullsLast(String::compareTo)))
                .toList();

        List<AdminBuildingHeatVO> hotBuildingList = buildingStats.values().stream()
                .map(this::toBuildingHeatVO)
                .sorted(Comparator
                        .comparing(AdminBuildingHeatVO::getReservationCount, Comparator.reverseOrder())
                        .thenComparing(AdminBuildingHeatVO::getReservedMinutes, Comparator.reverseOrder())
                        .thenComparing(AdminBuildingHeatVO::getBuilding, Comparator.nullsLast(String::compareTo)))
                .toList();

        List<AdminTimeSlotHeatVO> hotTimeSlotList = timeSlotStats.values().stream()
                .map(this::toTimeSlotHeatVO)
                .sorted(Comparator
                        .comparing(AdminTimeSlotHeatVO::getReservedMinutes, Comparator.reverseOrder())
                        .thenComparing(AdminTimeSlotHeatVO::getReservationCount, Comparator.reverseOrder())
                        .thenComparing(AdminTimeSlotHeatVO::getLabel, Comparator.nullsLast(String::compareTo)))
                .toList();

        List<AdminUserReservationStatVO> userReservationList = userStats.values().stream()
                .map(this::toUserReservationStatVO)
                .sorted(Comparator
                        .comparing(AdminUserReservationStatVO::getReservationCount, Comparator.reverseOrder())
                        .thenComparing(AdminUserReservationStatVO::getReservedMinutes, Comparator.reverseOrder())
                        .thenComparing(AdminUserReservationStatVO::getUsername, Comparator.nullsLast(String::compareTo)))
                .toList();

        long activeReservationCount = scopedReservations.stream()
                .filter(item -> ReservationStatus.ACTIVE.name().equals(item.getStatus()))
                .count();
        long totalAvailableSeatMinutes = classrooms.stream()
                .mapToLong(classroom -> {
                    long capacity = classroomCapacity(classroom);
                    if (capacity <= 0 || availableMinutesPerDay <= 0) {
                        return 0L;
                    }
                    return capacity * availableMinutesPerDay * windowDayCount;
                })
                .sum();
        long totalOccupiedSeatMinutes = classroomStats.values().stream()
                .mapToLong(item -> item.occupiedSeatMinutes)
                .sum();

        AdminAnalyticsVO analyticsVO = new AdminAnalyticsVO();
        analyticsVO.setWindowDays(normalizedDays);
        analyticsVO.setWindowLabel(normalizedDays == null ? "全部历史" : "最近" + normalizedDays + "天");
        analyticsVO.setClassroomCount(classrooms.size());
        analyticsVO.setEnabledClassroomCount((int) classrooms.stream().filter(item -> "ENABLED".equals(item.getStatus())).count());
        analyticsVO.setTotalUserCount(users.size());
        analyticsVO.setTotalReservations((long) scopedReservations.size());
        analyticsVO.setActiveReservations(activeReservationCount);
        analyticsVO.setCheckedInCount(checkedInCount);
        analyticsVO.setNoShowCount(noShowCount);
        analyticsVO.setAttendableReservationCount(attendableReservationCount);
        analyticsVO.setTotalReservedMinutes(totalReservedMinutes);
        analyticsVO.setOverallUtilizationRate(percentage(totalOccupiedSeatMinutes, totalAvailableSeatMinutes));
        analyticsVO.setClassroomUtilizationList(classroomUtilizationList);
        analyticsVO.setHotBuildingList(hotBuildingList);
        analyticsVO.setHotTimeSlotList(hotTimeSlotList);
        analyticsVO.setUserReservationList(userReservationList);
        return analyticsVO;
    }

    private User getUser(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        return user;
    }

    private AdminUserVO toUserVO(User user) {
        AdminUserVO userVO = new AdminUserVO();
        BeanUtils.copyProperties(user, userVO);
        userVO.setOnline(tokenService.hasActiveSession(user.getId()));
        return userVO;
    }

    private AdminReservationVO toReservationVO(Reservation reservation,
                                               Map<Long, User> userMap,
                                               Map<Long, Classroom> classroomMap,
                                               Map<Long, Seat> seatMap) {
        AdminReservationVO reservationVO = new AdminReservationVO();
        BeanUtils.copyProperties(reservation, reservationVO);

        User user = userMap.get(reservation.getUserId());
        if (user != null) {
            reservationVO.setUsername(user.getUsername());
            reservationVO.setNickname(user.getNickname());
        }

        Classroom classroom = classroomMap.get(reservation.getClassroomId());
        if (classroom != null) {
            String resourceName = classroom.getBuilding() + " " + classroom.getRoomNumber();
            if (ResourceType.SEAT.name().equals(reservation.getResourceType())) {
                Seat seat = seatMap.get(reservation.getResourceId());
                if (seat != null) {
                    resourceName = resourceName + " " + seat.getSeatNumber();
                }
            }
            reservationVO.setResourceName(resourceName);
        }
        return reservationVO;
    }

    private boolean matchReservationKeyword(AdminReservationVO reservation, String keyword) {
        if (!StringUtils.hasText(keyword)) {
            return true;
        }
        String normalized = keyword.trim().toLowerCase(Locale.ROOT);
        return contains(reservation.getUsername(), normalized)
                || contains(reservation.getNickname(), normalized)
                || contains(reservation.getResourceName(), normalized)
                || contains(reservation.getReason(), normalized)
                || contains(String.valueOf(reservation.getId()), normalized);
    }

    private boolean contains(String source, String keyword) {
        return source != null && source.toLowerCase(Locale.ROOT).contains(keyword);
    }

    private Integer normalizeDays(Integer days) {
        return days == null || days <= 0 ? null : days;
    }

    private String normalize(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private long calculateWindowDayCount(Integer normalizedDays, List<Reservation> reservations, LocalDateTime now) {
        if (normalizedDays != null) {
            return normalizedDays;
        }
        if (reservations.isEmpty()) {
            return 1L;
        }
        LocalDate earliestDate = reservations.stream()
                .map(Reservation::getStartTime)
                .filter(Objects::nonNull)
                .min(LocalDateTime::compareTo)
                .map(LocalDateTime::toLocalDate)
                .orElse(now.toLocalDate());
        return Math.max(1L, Duration.between(earliestDate.atStartOfDay(), now).toDays() + 1);
    }

    private long getAvailableMinutesPerDay() {
        LocalTime reservationStartTime = systemConfigService.getReservationStartTime();
        LocalTime reservationEndTime = systemConfigService.getReservationEndTime();
        return Math.max(0L, Duration.between(reservationStartTime, reservationEndTime).toMinutes());
    }

    private void accumulateClassroom(Map<Long, ClassroomAccumulator> classroomStats,
                                     Classroom classroom,
                                     Reservation reservation,
                                     long durationMinutes) {
        ClassroomAccumulator accumulator = classroomStats.computeIfAbsent(classroom.getId(), key -> new ClassroomAccumulator());
        accumulator.reservationCount++;
        accumulator.reservedMinutes += durationMinutes;
        long occupiedUnits = ResourceType.CLASSROOM.name().equals(reservation.getResourceType())
                ? classroomCapacity(classroom)
                : 1L;
        accumulator.occupiedSeatMinutes += durationMinutes * occupiedUnits;
    }

    private void accumulateBuilding(Map<String, BuildingAccumulator> buildingStats,
                                    Classroom classroom,
                                    long durationMinutes) {
        String building = classroom.getBuilding();
        if (!StringUtils.hasText(building)) {
            return;
        }
        BuildingAccumulator accumulator = buildingStats.computeIfAbsent(building, key -> new BuildingAccumulator());
        accumulator.building = building;
        accumulator.reservationCount++;
        accumulator.reservedMinutes += durationMinutes;
    }

    private void accumulateTimeSlots(Map<Integer, TimeSlotAccumulator> timeSlotStats, Reservation reservation) {
        LocalDateTime start = reservation.getStartTime();
        LocalDateTime end = reservation.getEndTime();
        if (start == null || end == null || !end.isAfter(start)) {
            return;
        }
        LocalDateTime cursor = start.withMinute(0).withSecond(0).withNano(0);
        while (cursor.isBefore(end)) {
            LocalDateTime nextCursor = cursor.plusHours(1);
            LocalDateTime overlapStart = start.isAfter(cursor) ? start : cursor;
            LocalDateTime overlapEnd = end.isBefore(nextCursor) ? end : nextCursor;
            long overlapMinutes = Duration.between(overlapStart, overlapEnd).toMinutes();
            if (overlapMinutes > 0) {
                int hour = cursor.getHour();
                TimeSlotAccumulator accumulator = timeSlotStats.computeIfAbsent(hour, TimeSlotAccumulator::new);
                accumulator.reservationCount++;
                accumulator.reservedMinutes += overlapMinutes;
            }
            cursor = nextCursor;
        }
    }

    private void accumulateUser(Map<Long, UserReservationAccumulator> userStats,
                                Reservation reservation,
                                User user,
                                long durationMinutes) {
        Long userId = reservation.getUserId();
        if (userId == null) {
            return;
        }
        UserReservationAccumulator accumulator = userStats.computeIfAbsent(userId, key -> new UserReservationAccumulator());
        accumulator.userId = userId;
        if (user != null) {
            accumulator.username = user.getUsername();
            accumulator.nickname = user.getNickname();
            accumulator.role = user.getRole();
        }
        accumulator.reservationCount++;
        accumulator.reservedMinutes += durationMinutes;
        if (ReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            accumulator.activeReservationCount++;
        }
    }

    private AdminClassroomUtilizationVO toClassroomUtilizationVO(Classroom classroom,
                                                                 ClassroomAccumulator accumulator,
                                                                 long windowDayCount,
                                                                 long availableMinutesPerDay) {
        AdminClassroomUtilizationVO utilizationVO = new AdminClassroomUtilizationVO();
        utilizationVO.setClassroomId(classroom.getId());
        utilizationVO.setBuilding(classroom.getBuilding());
        utilizationVO.setRoomNumber(classroom.getRoomNumber());
        utilizationVO.setStatus(classroom.getStatus());
        int capacity = (int) classroomCapacity(classroom);
        utilizationVO.setCapacity(capacity);
        utilizationVO.setReservationCount(accumulator == null ? 0L : accumulator.reservationCount);
        utilizationVO.setReservedMinutes(accumulator == null ? 0L : accumulator.reservedMinutes);
        long denominator = capacity <= 0 || availableMinutesPerDay <= 0
                ? 0L
                : (long) capacity * availableMinutesPerDay * windowDayCount;
        utilizationVO.setUtilizationRate(percentage(accumulator == null ? 0L : accumulator.occupiedSeatMinutes, denominator));
        return utilizationVO;
    }

    private AdminBuildingHeatVO toBuildingHeatVO(BuildingAccumulator accumulator) {
        AdminBuildingHeatVO buildingHeatVO = new AdminBuildingHeatVO();
        buildingHeatVO.setBuilding(accumulator.building);
        buildingHeatVO.setReservationCount(accumulator.reservationCount);
        buildingHeatVO.setReservedMinutes(accumulator.reservedMinutes);
        return buildingHeatVO;
    }

    private AdminTimeSlotHeatVO toTimeSlotHeatVO(TimeSlotAccumulator accumulator) {
        AdminTimeSlotHeatVO timeSlotHeatVO = new AdminTimeSlotHeatVO();
        timeSlotHeatVO.setLabel(String.format("%02d:00-%02d:00", accumulator.hour, (accumulator.hour + 1) % 24));
        timeSlotHeatVO.setReservationCount(accumulator.reservationCount);
        timeSlotHeatVO.setReservedMinutes(accumulator.reservedMinutes);
        return timeSlotHeatVO;
    }

    private AdminUserReservationStatVO toUserReservationStatVO(UserReservationAccumulator accumulator) {
        AdminUserReservationStatVO userReservationStatVO = new AdminUserReservationStatVO();
        userReservationStatVO.setUserId(accumulator.userId);
        userReservationStatVO.setUsername(accumulator.username);
        userReservationStatVO.setNickname(accumulator.nickname);
        userReservationStatVO.setRole(accumulator.role);
        userReservationStatVO.setReservationCount(accumulator.reservationCount);
        userReservationStatVO.setActiveReservationCount(accumulator.activeReservationCount);
        userReservationStatVO.setCheckedInCount(accumulator.checkedInCount);
        userReservationStatVO.setNoShowCount(accumulator.noShowCount);
        userReservationStatVO.setNoShowRate(percentage(
                accumulator.noShowCount,
                accumulator.checkedInCount + accumulator.noShowCount
        ));
        userReservationStatVO.setReservedMinutes(accumulator.reservedMinutes);
        return userReservationStatVO;
    }

    private long reservationDurationMinutes(Reservation reservation) {
        LocalDateTime start = reservation.getStartTime();
        LocalDateTime end = reservation.getEndTime();
        if (start == null || end == null || !end.isAfter(start)) {
            return 0L;
        }
        return Duration.between(start, end).toMinutes();
    }

    private long classroomCapacity(Classroom classroom) {
        if (classroom == null || classroom.getSeatRows() == null || classroom.getSeatCols() == null) {
            return 0L;
        }
        return (long) classroom.getSeatRows() * classroom.getSeatCols();
    }

    private double percentage(long numerator, long denominator) {
        if (denominator <= 0) {
            return 0D;
        }
        double rate = (double) numerator * 100 / denominator;
        return Math.round(rate * 10D) / 10D;
    }

    private LocalDateTime utcNow() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    private String buildUserStatusNotice(Integer status, String reason) {
        String action = status == 0
                ? "您的账号已被管理员封禁，当前无法继续登录和发起新的预约。"
                : "您的账号已被管理员恢复，可正常登录和使用预约功能。";
        if (!StringUtils.hasText(reason)) {
            return action;
        }
        return action + "\n原因：" + reason.trim();
    }

    private String buildReservationCancelNotice(String reason) {
        String content = "您的预约已被管理员取消，请重新选择时间或联系管理员。";
        if (!StringUtils.hasText(reason)) {
            return content;
        }
        return content + "\n原因：" + reason.trim();
    }

    private String buildForceLogoutNotice(String reason) {
        String content = "您的账号已被管理员强制下线，请重新登录后继续使用。";
        if (!StringUtils.hasText(reason)) {
            return content;
        }
        return content + "\n原因：" + reason.trim();
    }

    private static final class ClassroomAccumulator {
        private long reservationCount;
        private long reservedMinutes;
        private long occupiedSeatMinutes;
    }

    private static final class BuildingAccumulator {
        private String building;
        private long reservationCount;
        private long reservedMinutes;
    }

    private static final class TimeSlotAccumulator {
        private final int hour;
        private long reservationCount;
        private long reservedMinutes;

        private TimeSlotAccumulator(int hour) {
            this.hour = hour;
        }
    }

    private static final class UserReservationAccumulator {
        private Long userId;
        private String username;
        private String nickname;
        private String role;
        private long reservationCount;
        private long activeReservationCount;
        private long checkedInCount;
        private long noShowCount;
        private long reservedMinutes;
    }
}
