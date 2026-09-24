package org.campus.classroom.vo;

import lombok.Data;

import java.util.List;

@Data
public class ClassroomSeatLayoutVO {
    private Long classroomId;
    private String classroomBuilding;
    private String classroomNumber;
    private Integer seatRows;
    private Integer seatCols;
    private List<SeatVO> seatVOS;
}