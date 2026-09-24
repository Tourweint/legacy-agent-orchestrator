package org.campus.classroom.service;

import org.campus.classroom.dto.MaintenanceCreateDTO;
import org.campus.classroom.vo.MaintenanceWindowVO;

import java.util.List;

public interface MaintenanceService {
    List<MaintenanceWindowVO> list(String status, String resourceType, Long classroomId);

    Long create(Long adminUserId, MaintenanceCreateDTO request);

    void cancel(Long id);
}
