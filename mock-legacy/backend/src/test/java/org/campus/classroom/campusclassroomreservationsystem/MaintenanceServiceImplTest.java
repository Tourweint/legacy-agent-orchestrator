package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.dto.MaintenanceCreateDTO;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.MaintenanceWindow;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.MaintenanceWindowMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.service.AdminService;
import org.campus.classroom.service.impl.MaintenanceServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MaintenanceServiceImplTest {

    @Mock
    private MaintenanceWindowMapper maintenanceWindowMapper;
    @Mock
    private ReservationMapper reservationMapper;
    @Mock
    private ClassroomMapper classroomMapper;
    @Mock
    private SeatMapper seatMapper;
    @Mock
    private UserMapper userMapper;
    @Mock
    private AdminService adminService;

    @InjectMocks
    private MaintenanceServiceImpl maintenanceService;

    @Test
    void create_shouldRejectWhenReservationConflictsAndClearDisabled() {
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now(ZoneOffset.UTC).plusHours(2);
        LocalDateTime endTime = startTime.plusHours(2);
        MaintenanceCreateDTO request = buildClassroomRequest(classroomId, startTime, endTime, "projector repair", false);

        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(enabledClassroom(classroomId));
        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(List.of(activeReservation(1001L)));
        when(reservationMapper.selectSeatConflictsInClassroomForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> maintenanceService.create(9001L, request)
        );

        assertEquals(ResultCode.CONFLICT, exception.getResultCode());
        verify(maintenanceWindowMapper, never()).insert(any(MaintenanceWindow.class));
        verify(adminService, never()).cancelReservation(any(), any(), any());
    }

    @Test
    void create_shouldCancelConflictsWhenClearEnabled() {
        Long classroomId = 22L;
        LocalDateTime startTime = LocalDateTime.now(ZoneOffset.UTC).plusHours(3);
        LocalDateTime endTime = startTime.plusHours(2);
        MaintenanceCreateDTO request = buildClassroomRequest(classroomId, startTime, endTime, "projector repair", true);

        when(classroomMapper.selectByIdForUpdate(classroomId)).thenReturn(enabledClassroom(classroomId));
        when(reservationMapper.selectClassroomConflictsForUpdate(classroomId, startTime, endTime))
                .thenReturn(List.of(activeReservation(1001L)));
        when(reservationMapper.selectSeatConflictsInClassroomForUpdate(classroomId, startTime, endTime))
                .thenReturn(List.of(activeReservation(1002L)));
        when(maintenanceWindowMapper.selectConflictsInClassroomForUpdate(classroomId, startTime, endTime))
                .thenReturn(Collections.emptyList());
        doAnswer(invocation -> {
            MaintenanceWindow maintenanceWindow = invocation.getArgument(0);
            maintenanceWindow.setId(501L);
            return 1;
        }).when(maintenanceWindowMapper).insert(any(MaintenanceWindow.class));

        Long id = maintenanceService.create(9001L, request);

        assertEquals(501L, id);
        verify(maintenanceWindowMapper).insert(any(MaintenanceWindow.class));
        verify(adminService).cancelReservation(9001L, 1001L, "资源维护：projector repair");
        verify(adminService).cancelReservation(9001L, 1002L, "资源维护：projector repair");
    }

    private MaintenanceCreateDTO buildClassroomRequest(Long classroomId,
                                                       LocalDateTime startTime,
                                                       LocalDateTime endTime,
                                                       String reason,
                                                       boolean clearConflicts) {
        MaintenanceCreateDTO request = new MaintenanceCreateDTO();
        request.setResourceType(ResourceType.CLASSROOM.name());
        request.setResourceId(classroomId);
        request.setStartTime(startTime.atOffset(ZoneOffset.UTC));
        request.setEndTime(endTime.atOffset(ZoneOffset.UTC));
        request.setReason(reason);
        request.setClearConflictingReservations(clearConflicts);
        return request;
    }

    private Classroom enabledClassroom(Long classroomId) {
        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setStatus(ClassroomStatus.ENABLED.name());
        return classroom;
    }

    private Reservation activeReservation(Long reservationId) {
        Reservation reservation = new Reservation();
        reservation.setId(reservationId);
        return reservation;
    }
}
