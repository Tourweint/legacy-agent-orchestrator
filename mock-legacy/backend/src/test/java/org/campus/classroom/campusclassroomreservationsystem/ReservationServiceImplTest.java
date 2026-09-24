package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.dto.ClassroomReservationCreateDTO;
import org.campus.classroom.dto.SeatReservationCreateDTO;
import org.campus.classroom.entity.User;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.enums.ReservationStatus;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.AttendanceMapper;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.mapper.ViolationRecordMapper;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.service.impl.ReservationServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ReservationServiceImplTest {

    @Mock
    private ReservationMapper reservationMapper;
    @Mock
    private SeatMapper seatMapper;
    @Mock
    private ClassroomMapper classroomMapper;
    @Mock
    private AttendanceMapper attendanceMapper;
    @Mock
    private UserMapper userMapper;
    @Mock
    private ViolationRecordMapper violationRecordMapper;
    @Mock
    private SystemConfigService systemConfigService;

    @InjectMocks
    private ReservationServiceImpl reservationService;

    // 验证学生在资源、时间和配额都满足时可以成功创建座位预约。
    @Test
    void createSeatReservation_shouldCreateSuccessfully() {
        Long userId = 10001L;
        Long seatId = 11L;
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(2);
        SeatReservationCreateDTO request = buildSeatRequest(seatId, startTime, endTime, "self-study");
        mockDefaultReservationConfig();
        mockStudent(userId);

        when(reservationMapper.selectStudentTimeConflictForUpdate(userId, startTime, endTime)).thenReturn(0);

        Seat seat = new Seat();
        seat.setId(seatId);
        seat.setClassroomId(classroomId);
        seat.setStatus(SeatStatus.ENABLED.name());
        when(seatMapper.selectByIdForUpdate(seatId)).thenReturn(seat);

        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(classroom);

        when(reservationMapper.selectSeatConflictsForUpdate(seatId, startTime, endTime)).thenReturn(Collections.emptyList());
        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.tryAddUsage(any(Long.class), any(java.time.LocalDate.class), any(Long.class), any(Integer.class)))
                .thenReturn(1);

        doAnswer(invocation -> {
            Reservation reservation = invocation.getArgument(0);
            reservation.setId(999L);
            return 1;
        }).when(reservationMapper).insert(any(Reservation.class));

        Long reservationId = reservationService.createSeatReservation(userId, request);

        assertEquals(999L, reservationId);
        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationMapper).insert(captor.capture());
        Reservation created = captor.getValue();

        assertNotNull(created);
        assertEquals(userId, created.getUserId());
        assertEquals(ResourceType.SEAT.name(), created.getResourceType());
        assertEquals(seatId, created.getResourceId());
        assertEquals(classroomId, created.getClassroomId());
        assertEquals(request.getStartTime().withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate(), created.getReserveDate());
        assertEquals(startTime, created.getStartTime());
        assertEquals(endTime, created.getEndTime());
        assertEquals("self-study", created.getReason());
        assertEquals(ReservationStatus.ACTIVE.name(), created.getStatus());
    }

    // 验证学生在同一时间段已有预约时会被拦截，不能重复占用时间资源。
    @Test
    void createSeatReservation_shouldThrowConflictWhenUserTimeConflict() {
        Long userId = 10001L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(2);
        SeatReservationCreateDTO request = buildSeatRequest(11L, startTime, endTime, "self-study");
        mockDefaultReservationConfig();
        mockStudent(userId);

        Seat seat = new Seat();
        seat.setId(11L);
        seat.setClassroomId(22L);
        seat.setStatus(SeatStatus.ENABLED.name());
        when(seatMapper.selectByIdForUpdate(11L)).thenReturn(seat);

        Classroom classroom = new Classroom();
        classroom.setId(22L);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        when(classroomMapper.selectByIdForUpdate(22L)).thenReturn(classroom);

        when(reservationMapper.selectSeatConflictsForUpdate(11L, startTime, endTime)).thenReturn(Collections.emptyList());
        when(reservationMapper.selectClassroomConflictsForUpdate(22L, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.selectStudentTimeConflictForUpdate(userId, startTime, endTime)).thenReturn(1);

        BusinessException exception =
                assertThrows(BusinessException.class, () -> reservationService.createSeatReservation(userId, request));

        assertEquals(ResultCode.CONFLICT, exception.getResultCode());
        verify(reservationMapper, never()).insert(any(Reservation.class));
    }

    // 验证禁用座位不能被创建预约。
    @Test
    void createSeatReservation_shouldThrowForbiddenWhenSeatDisabled() {
        Long userId = 10001L;
        Long seatId = 11L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(2);
        SeatReservationCreateDTO request = buildSeatRequest(seatId, startTime, endTime, "self-study");
        mockDefaultReservationConfig();
        mockStudent(userId);

        Seat seat = new Seat();
        seat.setId(seatId);
        seat.setClassroomId(22L);
        seat.setStatus(SeatStatus.DISABLED.name());
        when(seatMapper.selectByIdForUpdate(seatId)).thenReturn(seat);

        BusinessException exception =
                assertThrows(BusinessException.class, () -> reservationService.createSeatReservation(userId, request));

        assertEquals(ResultCode.FORBIDDEN, exception.getResultCode());
        verify(reservationMapper, never()).insert(any(Reservation.class));
    }

    // 验证学生单次预约时长会受信用等级对应的上限约束。
    @Test
    void createSeatReservation_shouldUseCreditBasedSingleLimit() {
        Long userId = 10001L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(3);
        SeatReservationCreateDTO request = buildSeatRequest(11L, startTime, endTime, "self-study");
        mockDefaultReservationConfig();

        User user = new User();
        user.setId(userId);
        user.setRole("STUDENT");
        user.setCreditScore(35);
        when(userMapper.selectById(userId)).thenReturn(user);
        when(systemConfigService.getMaxSingleReservationMinutes(35)).thenReturn(120);

        BusinessException exception =
                assertThrows(BusinessException.class, () -> reservationService.createSeatReservation(userId, request));

        assertEquals(ResultCode.BAD_REQUEST, exception.getResultCode());
        verify(reservationMapper, never()).insert(any(Reservation.class));
    }

    // 验证教师或管理员在教室空闲时可以成功创建整间教室预约。
    @Test
    void createClassroomReservation_shouldCreateSuccessfully() {
        Long userId = 10001L;
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(2);
        ClassroomReservationCreateDTO request = buildClassroomRequest(classroomId, startTime, endTime, "class meeting");
        mockDefaultReservationConfig();
        mockTeacher(userId);

        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(classroom);

        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.selectSeatConflictsInClassroomForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.tryAddUsage(any(Long.class), any(java.time.LocalDate.class), any(Long.class), any(Integer.class)))
                .thenReturn(1);

        doAnswer(invocation -> {
            Reservation reservation = invocation.getArgument(0);
            reservation.setId(1000L);
            return 1;
        }).when(reservationMapper).insert(any(Reservation.class));

        Long reservationId = reservationService.createClassroomReservation(userId, request);

        assertEquals(1000L, reservationId);
        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationMapper).insert(captor.capture());
        Reservation created = captor.getValue();

        assertNotNull(created);
        assertEquals(userId, created.getUserId());
        assertEquals(ResourceType.CLASSROOM.name(), created.getResourceType());
        assertEquals(classroomId, created.getResourceId());
        assertEquals(classroomId, created.getClassroomId());
        assertEquals(request.getStartTime().withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate(), created.getReserveDate());
        assertEquals(startTime, created.getStartTime());
        assertEquals(endTime, created.getEndTime());
        assertEquals("class meeting", created.getReason());
        assertEquals(ReservationStatus.ACTIVE.name(), created.getStatus());
        verify(attendanceMapper, never()).insertStatusIfAbsent(any(Long.class), any(String.class));
    }

    // 验证教室已存在整间预约冲突时不能再次整间预约。
    @Test
    void createClassroomReservation_shouldThrowConflictWhenClassroomOccupied() {
        Long userId = 10001L;
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(2);
        ClassroomReservationCreateDTO request = buildClassroomRequest(classroomId, startTime, endTime, "class meeting");
        mockDefaultReservationConfig();
        mockStudent(userId);

        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(classroom);

        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.singletonList(new Reservation()));

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> reservationService.createClassroomReservation(userId, request)
        );

        assertEquals(ResultCode.CONFLICT, exception.getResultCode());
        verify(reservationMapper, never()).insert(any(Reservation.class));
    }

    // 验证教室内已有座位预约时不能再创建整间教室预约。
    @Test
    void createClassroomReservation_shouldThrowConflictWhenSeatAlreadyReserved() {
        Long userId = 10001L;
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now().plusHours(1);
        LocalDateTime endTime = startTime.plusHours(2);
        ClassroomReservationCreateDTO request = buildClassroomRequest(classroomId, startTime, endTime, "class meeting");
        mockDefaultReservationConfig();
        mockStudent(userId);

        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(classroom);

        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.selectSeatConflictsInClassroomForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.singletonList(new Reservation()));

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> reservationService.createClassroomReservation(userId, request)
        );

        assertEquals(ResultCode.CONFLICT, exception.getResultCode());
        verify(reservationMapper, never()).insert(any(Reservation.class));
    }

    // 验证有效预约可以被用户主动取消，并回滚已占用的预约额度与信用分。
    @Test
    void cancelReservation_shouldSucceedWhenReservationIsActive() {
        Long userId = 10001L;
        Long reservationId = 20001L;
        mockDefaultReservationConfig();

        Reservation reservation = new Reservation();
        reservation.setId(reservationId);
        reservation.setUserId(userId);
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        reservation.setReserveDate(LocalDateTime.now().toLocalDate());
        reservation.setStartTime(LocalDateTime.now());
        reservation.setEndTime(LocalDateTime.now().plusHours(1));

        when(reservationMapper.selectByReservationIdAndUserId(reservationId, userId)).thenReturn(reservation);
        when(reservationMapper.cancelReservation(reservationId)).thenReturn(1);
        when(reservationMapper.minusUsage(any(Long.class), any(java.time.LocalDate.class), any(Long.class))).thenReturn(1);
        User user = new User();
        user.setId(userId);
        user.setRole("STUDENT");
        when(userMapper.selectById(userId)).thenReturn(user);
        when(userMapper.decreaseCreditScore(userId, 1, 30, 100)).thenReturn(1);

        Boolean cancelled = reservationService.cancelReservation(userId, reservationId);

        assertEquals(true, cancelled);
        verify(reservationMapper).cancelReservation(reservationId);
        verify(userMapper).decreaseCreditScore(userId, 1, 30, 100);
    }

    // 验证教师整间预约不受学生信用分对应的单次和每日预约额度限制。
    @Test
    void createClassroomReservation_shouldBypassSingleAndDailyQuotaForTeacher() {
        Long userId = 10001L;
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now().plusDays(1).withHour(1).withMinute(0).withSecond(0).withNano(0);
        LocalDateTime endTime = startTime.plusHours(8);
        ClassroomReservationCreateDTO request = buildClassroomRequest(classroomId, startTime, endTime, "class meeting");
        mockDefaultReservationConfig();

        User user = new User();
        user.setId(userId);
        user.setRole("TEACHER");
        user.setCreditScore(35);
        when(userMapper.selectById(userId)).thenReturn(user);

        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(classroom);

        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.selectSeatConflictsInClassroomForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.tryAddUsage(any(Long.class), any(java.time.LocalDate.class), any(Long.class), any(Integer.class)))
                .thenReturn(1);
        doAnswer(invocation -> {
            Reservation reservation = invocation.getArgument(0);
            reservation.setId(1000L);
            return 1;
        }).when(reservationMapper).insert(any(Reservation.class));

        Long reservationId = reservationService.createClassroomReservation(userId, request);

        assertEquals(1000L, reservationId);
        verify(systemConfigService, never()).getMaxSingleReservationMinutes(any());
        verify(systemConfigService, never()).getDailyReservationLimitMinutes(any());
    }

    // 验证教师取消整间教室预约时不会触发学生侧的信用扣分和签到状态处理。
    @Test
    void cancelReservation_shouldNotDeductTeacherCredit() {
        Long userId = 10001L;
        Long reservationId = 20001L;
        mockDefaultReservationConfig();

        Reservation reservation = new Reservation();
        reservation.setId(reservationId);
        reservation.setUserId(userId);
        reservation.setResourceType(ResourceType.CLASSROOM.name());
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        reservation.setReserveDate(LocalDateTime.now().toLocalDate());
        reservation.setStartTime(LocalDateTime.now());
        reservation.setEndTime(LocalDateTime.now().plusHours(1));

        when(reservationMapper.selectByReservationIdAndUserId(reservationId, userId)).thenReturn(reservation);
        when(reservationMapper.cancelReservation(reservationId)).thenReturn(1);
        when(reservationMapper.minusUsage(any(Long.class), any(java.time.LocalDate.class), any(Long.class))).thenReturn(1);

        User teacher = new User();
        teacher.setId(userId);
        teacher.setRole("TEACHER");
        when(userMapper.selectById(userId)).thenReturn(teacher);

        Boolean cancelled = reservationService.cancelReservation(userId, reservationId);

        assertEquals(true, cancelled);
        verify(userMapper, never()).decreaseCreditScore(any(Long.class), any(Integer.class), any(Integer.class), any(Integer.class));
        verify(attendanceMapper, never()).insertStatusIfAbsent(any(Long.class), any(String.class));
        verify(attendanceMapper, never()).updateStatusIfPending(any(Long.class), any(String.class));
    }

    // 验证取消预约时如果状态被并发修改，会返回冲突而不是误判成功。
    @Test
    void cancelReservation_shouldThrowConflictWhenReservationStatusChangesConcurrently() {
        Long userId = 10001L;
        Long reservationId = 20001L;

        Reservation reservation = new Reservation();
        reservation.setId(reservationId);
        reservation.setUserId(userId);
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        reservation.setEndTime(LocalDateTime.now().plusHours(1));

        when(reservationMapper.selectByReservationIdAndUserId(reservationId, userId)).thenReturn(reservation);
        when(reservationMapper.cancelReservation(reservationId)).thenReturn(0);

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> reservationService.cancelReservation(userId, reservationId)
        );

        assertEquals(ResultCode.CONFLICT, exception.getResultCode());
    }

    private SeatReservationCreateDTO buildSeatRequest(Long seatId, LocalDateTime startTime, LocalDateTime endTime, String reason) {
        SeatReservationCreateDTO request = new SeatReservationCreateDTO();
        request.setSeatId(seatId);
        request.setStartTime(startTime.atOffset(ZoneOffset.UTC));
        request.setEndTime(endTime.atOffset(ZoneOffset.UTC));
        request.setReason(reason);
        return request;
    }

    private ClassroomReservationCreateDTO buildClassroomRequest(Long classroomId, LocalDateTime startTime,
                                                                LocalDateTime endTime, String reason) {
        ClassroomReservationCreateDTO request = new ClassroomReservationCreateDTO();
        request.setClassroomId(classroomId);
        request.setStartTime(startTime.atOffset(ZoneOffset.UTC));
        request.setEndTime(endTime.atOffset(ZoneOffset.UTC));
        request.setReason(reason);
        return request;
    }

    private void mockDefaultReservationConfig() {
        lenient().when(systemConfigService.getMaxSingleReservationMinutes(any())).thenReturn(180);
        lenient().when(systemConfigService.getDailyReservationLimitMinutes(any())).thenReturn(540);
        lenient().when(systemConfigService.getSeatReservationAdvanceHours(any())).thenReturn(24);
        lenient().when(systemConfigService.getCancelDeductionScore()).thenReturn(1);
        lenient().when(systemConfigService.getCreditMinScore()).thenReturn(30);
        lenient().when(systemConfigService.getCreditMaxScore()).thenReturn(100);
    }

    private void mockStudent(Long userId) {
        User user = new User();
        user.setId(userId);
        user.setRole("STUDENT");
        user.setCreditScore(100);
        when(userMapper.selectById(userId)).thenReturn(user);
    }

    private void mockTeacher(Long userId) {
        User user = new User();
        user.setId(userId);
        user.setRole("TEACHER");
        user.setCreditScore(100);
        when(userMapper.selectById(userId)).thenReturn(user);
    }
}
