package org.campus.classroom.service;

import org.campus.classroom.dto.SeatUpdateDTO;
import org.campus.classroom.dto.SeatCreateDTO;
import org.campus.classroom.vo.ClassroomSeatLayoutVO;
import org.campus.classroom.vo.SeatVO;

public interface SeatService {
    void initSeats(Long classroomId);

    SeatVO getSeatById(Long id);

    ClassroomSeatLayoutVO getSeatLayout(Long classroomId);

    SeatVO create(Long classroomId, SeatCreateDTO request);

    Boolean update(Long id, SeatUpdateDTO request);

    Boolean delete(Long id);

    Boolean batchUpdateSeats(Long classroomId, SeatUpdateDTO request);

    Boolean batchDeleteSeats(Long classroomId);
}
