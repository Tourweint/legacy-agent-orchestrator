package org.campus.classroom.vo;

import lombok.Data;

@Data
public class ClassroomVO {
    private Long id;
    private String roomNumber;
    private String building;
    private Integer seatRows;
    private Integer seatCols;
    private Integer capacity;
    private String status;
    private String remark;
}