package org.campus.classroom.vo;

import lombok.Data;

@Data
public class SeatVO {
    private Long id;
    private Long classroomId;
    private String seatNumber;
    private Integer rowNumber;
    private Integer colNumber;
    private String status;
    private String remark;
}
